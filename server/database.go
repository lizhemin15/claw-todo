package main

import (
	"database/sql"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// InitDB initializes the SQLite database
func InitDB(dbPath string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}

	// Enable WAL mode for better concurrent performance
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, err
	}
	if _, err := db.Exec("PRAGMA foreign_keys=ON"); err != nil {
		return nil, err
	}

	if err := createTables(db); err != nil {
		return nil, err
	}

	return db, nil
}

func createTables(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'admin',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS todos (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		description TEXT DEFAULT '',
		priority TEXT NOT NULL DEFAULT 'normal',
		status TEXT NOT NULL DEFAULT 'pending',
		due TEXT DEFAULT '',
		tags TEXT DEFAULT '[]',
		source TEXT NOT NULL DEFAULT 'manual',
		metadata TEXT DEFAULT '{}',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		completed_at TEXT DEFAULT ''
	);

	CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
	CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);
	CREATE INDEX IF NOT EXISTS idx_todos_source ON todos(source);
	CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due);
	CREATE INDEX IF NOT EXISTS idx_todos_created ON todos(created_at DESC);

	CREATE TABLE IF NOT EXISTS sync_log (
		id TEXT PRIMARY KEY,
		todo_id TEXT NOT NULL,
		action TEXT NOT NULL,
		direction TEXT NOT NULL DEFAULT 'pull',
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		status TEXT NOT NULL DEFAULT 'pending',
		FOREIGN KEY (todo_id) REFERENCES todos(id)
	);

	CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_log(status);

	CREATE TABLE IF NOT EXISTS pair_codes (
		code TEXT PRIMARY KEY,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL,
		used INTEGER DEFAULT 0
	);

	CREATE INDEX IF NOT EXISTS idx_pair_expires ON pair_codes(expires_at);

	CREATE TABLE IF NOT EXISTS user_game_state (
		username TEXT PRIMARY KEY,
		state TEXT NOT NULL DEFAULT '{}',
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err := db.Exec(schema)
	return err
}

// Todo represents a todo item
type Todo struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Priority    string    `json:"priority"`
	Status      string    `json:"status"`
	Due         string    `json:"due"`
	Tags        []string  `json:"tags"`
	Source      string    `json:"source"`
	Metadata    Metadata  `json:"metadata"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	CompletedAt string    `json:"completed_at"`
}

// Metadata is a flexible key-value map
type Metadata map[string]interface{}

// SyncEntry represents a sync log entry
type SyncEntry struct {
	ID        string    `json:"id"`
	TodoID    string    `json:"todo_id"`
	Action    string    `json:"action"`
	Direction string    `json:"direction"`
	Timestamp time.Time `json:"timestamp"`
	Status    string    `json:"status"`
}
