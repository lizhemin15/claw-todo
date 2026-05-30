package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
)

//go:embed static
var staticFiles embed.FS

//go:embed skill
var skillEmbed embed.FS

var (
	port      int
	dataDir   string
	jwtSecret string
)

func main() {
	flag.IntVar(&port, "port", 8080, "server port")
	flag.StringVar(&dataDir, "data", "./data", "data directory for SQLite DB")
	flag.StringVar(&jwtSecret, "secret", "", "JWT secret (auto-generated if empty)")
	flag.Parse()

	// Ensure data directory exists
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}

	// Initialize database
	dbPath := dataDir + "/claw-todo.db"
	db, err := InitDB(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Auto-generate JWT secret if not provided
	if jwtSecret == "" {
		jwtSecret, err = GenerateSecret()
		if err != nil {
			log.Fatalf("Failed to generate JWT secret: %v", err)
		}
		// Persist secret so it survives restarts
		secretPath := dataDir + "/.jwt_secret"
		if _, err := os.Stat(secretPath); os.IsNotExist(err) {
			if err := os.WriteFile(secretPath, []byte(jwtSecret), 0600); err != nil {
				log.Fatalf("Failed to persist JWT secret: %v", err)
			}
			log.Printf("JWT secret generated and saved to %s", secretPath)
		} else {
			data, err := os.ReadFile(secretPath)
			if err != nil {
				log.Fatalf("Failed to read JWT secret: %v", err)
			}
			jwtSecret = string(data)
		}
	}

	// Initialize auth
	auth := NewAuth(db, jwtSecret)

	// Initialize WebSocket hub
	hub := NewHub()
	go hub.Run()

	// Initialize handlers
	handler := NewHandler(db, auth, hub)

	// Load embedded skill files for well-known endpoint
	skillFiles = loadSkillFiles()

	// Router
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("POST /api/auth/setup", handler.Setup)
	mux.HandleFunc("POST /api/auth/login", handler.Login)
	mux.HandleFunc("POST /api/auth/token", handler.AuthMiddleware(handler.GenerateBindToken))
	mux.HandleFunc("GET /api/auth/status", handler.AuthStatus)

	// Pairing (auth required to generate, no auth to exchange)
	mux.HandleFunc("POST /api/pair/code", handler.AuthMiddleware(handler.GeneratePairCode))
	mux.HandleFunc("POST /api/pair/exchange", handler.ExchangePairCode)

	// Well-Known Skills Endpoint
	mux.HandleFunc("GET /.well-known/skills/index.json", handler.WellKnownIndex)
	mux.HandleFunc("/.well-known/skills/todo-push/", handler.WellKnownSkillFile)

	// Todo CRUD (auth required)
	mux.HandleFunc("POST /api/todos", handler.AuthMiddleware(handler.CreateTodo))
	mux.HandleFunc("GET /api/todos", handler.AuthMiddleware(handler.ListTodos))
	mux.HandleFunc("GET /api/todos/{id}", handler.AuthMiddleware(handler.GetTodo))
	mux.HandleFunc("PATCH /api/todos/{id}", handler.AuthMiddleware(handler.UpdateTodo))
	mux.HandleFunc("DELETE /api/todos/{id}", handler.AuthMiddleware(handler.DeleteTodo))

	// Sync
	mux.HandleFunc("GET /api/sync/pending", handler.AuthMiddleware(handler.SyncPending))
	mux.HandleFunc("POST /api/sync/ack", handler.AuthMiddleware(handler.SyncAck))

	// WebSocket
	mux.HandleFunc("/ws", handler.AuthMiddlewareWS(handler.HandleWebSocket))

	// Static files (embedded)
	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatalf("Failed to create sub filesystem: %v", err)
	}
	fileServer := http.FileServer(http.FS(staticFS))
	mux.Handle("/", fileServer)

	// CORS middleware for API
	wrappedMux := CORS(mux)

	addr := fmt.Sprintf(":%d", port)
	log.Printf("🦞 Claw Todo starting on %s", addr)
	log.Printf("   Data directory: %s", dataDir)
	log.Printf("   Open http://localhost%s in your browser", addr)

	// Graceful shutdown
	server := &http.Server{Addr: addr, Handler: wrappedMux}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")
	server.Close()
}

// CORS adds basic CORS headers
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// loadSkillFiles loads embedded skill files into memory for well-known endpoint
func loadSkillFiles() map[string]string {
	files := map[string]string{}

	// Walk the embedded skill directory
	entries, err := fs.ReadDir(skillEmbed, "skill")
	if err != nil {
		log.Printf("Warning: failed to read skill embed dir: %v", err)
		return files
	}

	// Load top-level files
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := entry.Name()
		data, err := fs.ReadFile(skillEmbed, "skill/"+path)
		if err != nil {
			log.Printf("Warning: failed to load skill file %s: %v", path, err)
			continue
		}
		files[path] = string(data)
	}

	// Load subdirectories (scripts/, references/, templates/, assets/)
	subDirs := []string{"scripts", "references", "templates", "assets"}
	for _, subDir := range subDirs {
		entries, err := fs.ReadDir(skillEmbed, "skill/"+subDir)
		if err != nil {
			continue // directory doesn't exist, skip
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			path := subDir + "/" + entry.Name()
			data, err := fs.ReadFile(skillEmbed, "skill/"+path)
			if err != nil {
				log.Printf("Warning: failed to load skill file %s: %v", path, err)
				continue
			}
			files[path] = string(data)
		}
	}

	// Parse SKILL.md frontmatter for skillMeta
	if content, ok := files["SKILL.md"]; ok {
		parseSkillFrontmatter(content)
	}

	log.Printf("Loaded %d skill files for well-known endpoint", len(files))
	return files
}

// parseSkillFrontmatter extracts name, description, version, files from SKILL.md YAML frontmatter
func parseSkillFrontmatter(content string) {
	// Find frontmatter between --- markers
	if !strings.HasPrefix(content, "---") {
		return
	}
	end := strings.Index(content[3:], "---")
	if end < 0 {
		return
	}
	fm := content[3 : end+3]

	// Simple YAML parsing (no external dependency)
	skillMeta.Name = extractYAMLString(fm, "name")
	skillMeta.Description = extractYAMLString(fm, "description")
	skillMeta.Version = extractYAMLString(fm, "version")

	// Parse files list
	skillMeta.Files = extractYAMLList(fm, "files")

	// Fallback: if files not specified, use actual loaded file paths
	if len(skillMeta.Files) == 0 {
		skillMeta.Files = make([]string, 0, len(skillFiles))
		for path := range skillFiles {
			skillMeta.Files = append(skillMeta.Files, path)
		}
		sort.Strings(skillMeta.Files)
	}

	log.Printf("Skill metadata: name=%s version=%s files=%v", skillMeta.Name, skillMeta.Version, skillMeta.Files)
}

// extractYAMLString extracts a string value from simple YAML (key: value)
func extractYAMLString(yaml, key string) string {
	for _, line := range strings.Split(yaml, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, key+":") {
			val := strings.TrimSpace(strings.TrimPrefix(line, key+":"))
			// Remove quotes
			val = strings.Trim(val, "\"'")
			return val
		}
	}
	return ""
}

// extractYAMLList extracts a list value from simple YAML (key:\n  - item1\n  - item2)
func extractYAMLList(yaml, key string) []string {
	lines := strings.Split(yaml, "\n")
	inList := false
	var result []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inList {
			if trimmed == key+":" {
				inList = true
				continue
			}
			continue
		}
		// Check if still in list (indented with - prefix)
		if strings.HasPrefix(trimmed, "- ") {
			item := strings.TrimSpace(strings.TrimPrefix(trimmed, "- "))
			item = strings.Trim(item, "\"'")
			result = append(result, item)
		} else if trimmed != "" && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "	") {
			// No longer indented, list ended
			break
		}
	}
	return result
}
