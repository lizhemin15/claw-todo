package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Auth handles authentication
type Auth struct {
	db        *sql.DB
	jwtSecret string
}

// NewAuth creates a new Auth instance
func NewAuth(db *sql.DB, jwtSecret string) *Auth {
	return &Auth{db: db, jwtSecret: jwtSecret}
}

// GenerateSecret generates a random secret
func GenerateSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// HashPassword hashes a password with SHA256
func HashPassword(password string) string {
	h := sha256.New()
	h.Write([]byte(password))
	return hex.EncodeToString(h.Sum(nil))
}

// Claims represents JWT claims
type Claims struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// GenerateToken generates a JWT token
func (a *Auth) GenerateToken(username, role string) (string, error) {
	claims := Claims{
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(365 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(a.jwtSecret))
}

// GenerateBindToken generates a token for skill binding (long-lived, role=agent)
func (a *Auth) GenerateBindToken(username string) (string, error) {
	claims := Claims{
		Username: username,
		Role:     "agent",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(10 * 365 * 24 * time.Hour)), // 10 years
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(a.jwtSecret))
}

// ValidateToken validates a JWT token and returns claims
func (a *Auth) ValidateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(a.jwtSecret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}
	return nil, fmt.Errorf("invalid token")
}

// IsSetup checks if initial setup has been done
func (a *Auth) IsSetup() bool {
	var count int
	a.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count > 0
}

// CreateUser creates a new user
func (a *Auth) CreateUser(username, password, role string) error {
	_, err := a.db.Exec(
		"INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
		username, HashPassword(password), role,
	)
	return err
}

// VerifyUser verifies user credentials
func (a *Auth) VerifyUser(username, password string) (bool, string, error) {
	var passwordHash, role string
	err := a.db.QueryRow(
		"SELECT password_hash, role FROM users WHERE username = ?",
		username,
	).Scan(&passwordHash, &role)
	if err == sql.ErrNoRows {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	return HashPassword(password) == passwordHash, role, nil
}

// AuthMiddleware validates JWT token from Authorization header
func (h *Handler) AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			// Also check query param for WebSocket convenience
			authHeader = "Bearer " + r.URL.Query().Get("token")
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing authorization header"})
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := h.auth.ValidateToken(tokenStr)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
			return
		}

		// Inject claims into request context
		r.Header.Set("X-User", claims.Username)
		r.Header.Set("X-Role", claims.Role)
		next(w, r)
	}
}

// AuthMiddlewareWS validates JWT for WebSocket connections
func (h *Handler) AuthMiddlewareWS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tokenStr := r.URL.Query().Get("token")
		if tokenStr == "" {
			authHeader := r.Header.Get("Authorization")
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		}

		if tokenStr == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing token"})
			return
		}

		claims, err := h.auth.ValidateToken(tokenStr)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
			return
		}

		r.Header.Set("X-User", claims.Username)
		r.Header.Set("X-Role", claims.Role)
		next(w, r)
	}
}

// writeJSON writes a JSON response
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
