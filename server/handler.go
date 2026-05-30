package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Handler handles HTTP requests
type Handler struct {
	db   *sql.DB
	auth *Auth
	hub  *Hub
}

// NewHandler creates a new Handler instance
func NewHandler(db *sql.DB, auth *Auth, hub *Hub) *Handler {
	return &Handler{db: db, auth: auth, hub: hub}
}

// Setup handles initial account creation
func (h *Handler) Setup(w http.ResponseWriter, r *http.Request) {
	if h.auth.IsSetup() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "setup already completed"})
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	if req.Username == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username and password required"})
		return
	}

	if err := h.auth.CreateUser(req.Username, req.Password, "admin"); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create user"})
		return
	}

	token, err := h.auth.GenerateToken(req.Username, "admin")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message": "setup completed",
		"token":   token,
	})
}

// Login handles user login
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	valid, role, err := h.auth.VerifyUser(req.Username, req.Password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if !valid {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	token, err := h.auth.GenerateToken(req.Username, role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

// AuthStatus returns authentication status
func (h *Handler) AuthStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"setup": h.auth.IsSetup(),
	})
}

// GeneratePairCode generates a 6-digit pairing code (requires login)
func (h *Handler) GeneratePairCode(w http.ResponseWriter, r *http.Request) {
	user := r.Header.Get("X-User")
	if user == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	// Generate 6-digit code
	code := generatePairCode()

	// Expire old codes for this user
	h.db.Exec("UPDATE pair_codes SET used = 1 WHERE username = ? AND used = 0", user)

	// Insert new code (5 min TTL)
	expiresAt := time.Now().Add(5 * time.Minute)
	_, err := h.db.Exec(
		"INSERT INTO pair_codes (code, username, expires_at) VALUES (?, ?, ?)",
		code, user, expiresAt,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate code"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"code":       code,
		"expires_in": 300,
	})
}

// ExchangePairCode exchanges a pairing code for a bind token (no login required)
func (h *Handler) ExchangePairCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code   string `json:"code"`
		Source string `json:"source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	if req.Code == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "code required"})
		return
	}

	// Look up code
	var username string
	var expiresAt time.Time
	var used int
	err := h.db.QueryRow(
		"SELECT username, expires_at, used FROM pair_codes WHERE code = ?",
		req.Code,
	).Scan(&username, &expiresAt, &used)

	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "invalid code"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	// Check if already used or expired
	if used == 1 {
		writeJSON(w, http.StatusGone, map[string]string{"error": "code already used"})
		return
	}
	if time.Now().After(expiresAt) {
		writeJSON(w, http.StatusGone, map[string]string{"error": "code expired"})
		return
	}

	// Mark code as used
	h.db.Exec("UPDATE pair_codes SET used = 1 WHERE code = ?", req.Code)

	// Generate bind token
	token, err := h.auth.GenerateBindToken(username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":    token,
		"username": username,
		"message":  "pairing successful",
	})
}

// generatePairCode generates a random 6-digit code
func generatePairCode() string {
	b := make([]byte, 3)
	rand.Read(b)
	num := int(b[0])<<16 | int(b[1])<<8 | int(b[2])
	return fmt.Sprintf("%06d", num%1000000)
}

// GenerateBindToken generates a token for skill binding
func (h *Handler) GenerateBindToken(w http.ResponseWriter, r *http.Request) {
	user := r.Header.Get("X-User")
	if user == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	token, err := h.auth.GenerateBindToken(user)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

// CreateTodo creates a new todo item
func (h *Handler) CreateTodo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string                 `json:"title"`
		Description string                 `json:"description"`
		Priority    string                 `json:"priority"`
		Due         string                 `json:"due"`
		Tags        []string               `json:"tags"`
		Source      string                 `json:"source"`
		Metadata    map[string]interface{} `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	if req.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title required"})
		return
	}

	// Set defaults
	if req.Priority == "" {
		req.Priority = "normal"
	}
	if req.Source == "" {
		req.Source = r.Header.Get("X-User")
	}
	if req.Tags == nil {
		req.Tags = []string{}
	}
	if req.Metadata == nil {
		req.Metadata = make(map[string]interface{})
	}

	id := uuid.New().String()
	tagsJSON, _ := json.Marshal(req.Tags)
	metadataJSON, _ := json.Marshal(req.Metadata)
	now := time.Now()

	_, err := h.db.Exec(`
		INSERT INTO todos (id, title, description, priority, status, due, tags, source, metadata, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
	`, id, req.Title, req.Description, req.Priority, req.Due, string(tagsJSON), req.Source, string(metadataJSON), now, now)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create todo"})
		return
	}

	todo := Todo{
		ID:          id,
		Title:       req.Title,
		Description: req.Description,
		Priority:    req.Priority,
		Status:      "pending",
		Due:         req.Due,
		Tags:        req.Tags,
		Source:      req.Source,
		Metadata:    Metadata(req.Metadata),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	// Broadcast to WebSocket clients
	h.hub.Broadcast("todo_created", todo)

	writeJSON(w, http.StatusCreated, todo)
}

// ListTodos lists todos with optional filters
func (h *Handler) ListTodos(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	priority := r.URL.Query().Get("priority")
	source := r.URL.Query().Get("source")

	query := "SELECT id, title, description, priority, status, due, tags, source, metadata, created_at, updated_at, completed_at FROM todos WHERE 1=1"
	args := []interface{}{}

	if status != "" {
		query += " AND status = ?"
		args = append(args, status)
	}
	if priority != "" {
		query += " AND priority = ?"
		args = append(args, priority)
	}
	if source != "" {
		query += " AND source = ?"
		args = append(args, source)
	}

	query += " ORDER BY created_at DESC"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to query todos"})
		return
	}
	defer rows.Close()

	todos := []Todo{}
	for rows.Next() {
		var todo Todo
		var tagsJSON, metadataJSON, completedAt string
		err := rows.Scan(
			&todo.ID, &todo.Title, &todo.Description, &todo.Priority, &todo.Status,
			&todo.Due, &tagsJSON, &todo.Source, &metadataJSON,
			&todo.CreatedAt, &todo.UpdatedAt, &completedAt,
		)
		if err != nil {
			log.Printf("Error scanning todo: %v", err)
			continue
		}
		json.Unmarshal([]byte(tagsJSON), &todo.Tags)
		json.Unmarshal([]byte(metadataJSON), &todo.Metadata)
		todo.CompletedAt = completedAt
		todos = append(todos, todo)
	}

	writeJSON(w, http.StatusOK, todos)
}

// GetTodo gets a single todo by ID
func (h *Handler) GetTodo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		id = r.URL.Query().Get("id")
	}

	var todo Todo
	var tagsJSON, metadataJSON, completedAt string
	err := h.db.QueryRow(`
		SELECT id, title, description, priority, status, due, tags, source, metadata, created_at, updated_at, completed_at
		FROM todos WHERE id = ?
	`, id).Scan(
		&todo.ID, &todo.Title, &todo.Description, &todo.Priority, &todo.Status,
		&todo.Due, &tagsJSON, &todo.Source, &metadataJSON,
		&todo.CreatedAt, &todo.UpdatedAt, &completedAt,
	)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "todo not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get todo"})
		return
	}

	json.Unmarshal([]byte(tagsJSON), &todo.Tags)
	json.Unmarshal([]byte(metadataJSON), &todo.Metadata)
	todo.CompletedAt = completedAt

	writeJSON(w, http.StatusOK, todo)
}

// UpdateTodo updates a todo item
func (h *Handler) UpdateTodo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		id = r.URL.Query().Get("id")
	}

	var req struct {
		Title       *string                `json:"title"`
		Description *string                `json:"description"`
		Priority    *string                `json:"priority"`
		Status      *string                `json:"status"`
		Due         *string                `json:"due"`
		Tags        []string               `json:"tags"`
		Metadata    map[string]interface{} `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	// Check if todo exists
	var exists bool
	h.db.QueryRow("SELECT 1 FROM todos WHERE id = ?", id).Scan(&exists)
	if !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "todo not found"})
		return
	}

	now := time.Now()
	updates := []string{"updated_at = ?"}
	args := []interface{}{now}

	if req.Title != nil {
		updates = append(updates, "title = ?")
		args = append(args, *req.Title)
	}
	if req.Description != nil {
		updates = append(updates, "description = ?")
		args = append(args, *req.Description)
	}
	if req.Priority != nil {
		updates = append(updates, "priority = ?")
		args = append(args, *req.Priority)
	}
	if req.Status != nil {
		updates = append(updates, "status = ?")
		args = append(args, *req.Status)
		if *req.Status == "completed" {
			updates = append(updates, "completed_at = ?")
			args = append(args, now.Format(time.RFC3339))

			// Log sync entry for bidirectional sync
			syncID := uuid.New().String()
			h.db.Exec(`
				INSERT INTO sync_log (id, todo_id, action, direction, status)
				VALUES (?, ?, 'complete', 'pull', 'pending')
			`, syncID, id)
		}
	}
	if req.Due != nil {
		updates = append(updates, "due = ?")
		args = append(args, *req.Due)
	}
	if req.Tags != nil {
		tagsJSON, _ := json.Marshal(req.Tags)
		updates = append(updates, "tags = ?")
		args = append(args, string(tagsJSON))
	}
	if req.Metadata != nil {
		metadataJSON, _ := json.Marshal(req.Metadata)
		updates = append(updates, "metadata = ?")
		args = append(args, string(metadataJSON))
	}

	args = append(args, id)
	query := fmt.Sprintf("UPDATE todos SET %s WHERE id = ?", strings.Join(updates, ", "))
	_, err := h.db.Exec(query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update todo"})
		return
	}

	// Fetch updated todo
	var todo Todo
	var tagsJSON, metadataJSON, completedAt string
	h.db.QueryRow(`
		SELECT id, title, description, priority, status, due, tags, source, metadata, created_at, updated_at, completed_at
		FROM todos WHERE id = ?
	`, id).Scan(
		&todo.ID, &todo.Title, &todo.Description, &todo.Priority, &todo.Status,
		&todo.Due, &tagsJSON, &todo.Source, &metadataJSON,
		&todo.CreatedAt, &todo.UpdatedAt, &completedAt,
	)
	json.Unmarshal([]byte(tagsJSON), &todo.Tags)
	json.Unmarshal([]byte(metadataJSON), &todo.Metadata)
	todo.CompletedAt = completedAt

	// Broadcast update
	h.hub.Broadcast("todo_updated", todo)

	writeJSON(w, http.StatusOK, todo)
}

// DeleteTodo deletes a todo item
func (h *Handler) DeleteTodo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		id = r.URL.Query().Get("id")
	}

	result, err := h.db.Exec("DELETE FROM todos WHERE id = ?", id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete todo"})
		return
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "todo not found"})
		return
	}

	// Broadcast deletion
	h.hub.Broadcast("todo_deleted", map[string]string{"id": id})

	writeJSON(w, http.StatusOK, map[string]string{"message": "deleted"})
}

// SyncPending returns pending sync entries
func (h *Handler) SyncPending(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`
		SELECT id, todo_id, action, direction, timestamp, status
		FROM sync_log WHERE status = 'pending' AND direction = 'pull'
		ORDER BY timestamp ASC
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to query sync log"})
		return
	}
	defer rows.Close()

	entries := []SyncEntry{}
	for rows.Next() {
		var e SyncEntry
		err := rows.Scan(&e.ID, &e.TodoID, &e.Action, &e.Direction, &e.Timestamp, &e.Status)
		if err != nil {
			continue
		}
		entries = append(entries, e)
	}

	writeJSON(w, http.StatusOK, entries)
}

// SyncAck acknowledges sync entries
func (h *Handler) SyncAck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	for _, id := range req.IDs {
		h.db.Exec("UPDATE sync_log SET status = 'synced' WHERE id = ?", id)
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "acknowledged"})
}

// HandleWebSocket handles WebSocket connections
func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	user := r.Header.Get("X-User")

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &Client{
		hub:  h.hub,
		conn: conn,
		send: make(chan []byte, 256),
		user: user,
	}
	h.hub.register <- client

	// Start read/write pumps
	go client.writePump()
	go client.readPump()
}

// ---------------------------------------------------------------------------
// Well-Known Skills Endpoint (/.well-known/skills/)
// ---------------------------------------------------------------------------

// skillFiles holds the embedded skill content served via well-known endpoint.
// Populated at startup from the skill directory.
var skillFiles map[string]string

// WellKnownIndex returns /.well-known/skills/index.json
func (h *Handler) WellKnownIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")

	index := map[string]interface{}{
		"skills": []map[string]interface{}{
			{
				"name":        "todo-push",
				"description": "推送待办事项到 Claw Todo。配对码一键连接，支持离线队列。",
				"version":     "2.0.0",
				"files": []string{
					"SKILL.md",
					"scripts/setup.py",
					"scripts/push_todo.py",
					"references/api.md",
				},
			},
		},
	}
	writeJSON(w, http.StatusOK, index)
}

// WellKnownSkillFile serves individual skill files under /.well-known/skills/todo-push/
func (h *Handler) WellKnownSkillFile(w http.ResponseWriter, r *http.Request) {
	// Path: /.well-known/skills/todo-push/<filepath>
	// Extract the file part after the skill name
	path := r.URL.Path
	prefix := "/.well-known/skills/todo-push/"
	if !strings.HasPrefix(path, prefix) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	filePath := strings.TrimPrefix(path, prefix)
	if filePath == "" {
		filePath = "SKILL.md"
	}

	content, ok := skillFiles[filePath]
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "file not found"})
		return
	}

	// Set content type
	contentType := "text/plain; charset=utf-8"
	if strings.HasSuffix(filePath, ".md") {
		contentType = "text/markdown; charset=utf-8"
	} else if strings.HasSuffix(filePath, ".py") {
		contentType = "text/x-python; charset=utf-8"
	} else if strings.HasSuffix(filePath, ".json") {
		contentType = "application/json"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Write([]byte(content))
}
