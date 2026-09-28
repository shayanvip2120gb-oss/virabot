CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    custom_name TEXT,
    phone TEXT,
    phone_normalized TEXT,
    phone_method TEXT,
    phone_verified INTEGER DEFAULT 0,
    registration_step TEXT DEFAULT 'started',
    public_channel_verified INTEGER DEFAULT 0,
    public_channel_verified_at TEXT,
    is_eligible INTEGER DEFAULT 0,
    eligible_at TEXT,
    private_channel_status TEXT DEFAULT 'none',
    private_channel_requested_at TEXT,
    private_channel_approved_at TEXT,
    is_bot_blocked INTEGER DEFAULT 0,
    campaign_source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_users_step ON users(registration_step);
CREATE INDEX IF NOT EXISTS idx_users_eligible ON users(is_eligible);
CREATE INDEX IF NOT EXISTS idx_users_private_status ON users(private_channel_status);

CREATE TABLE IF NOT EXISTS join_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    invite_link TEXT,
    rejection_reason TEXT,
    attempt_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_at TEXT,
    UNIQUE(telegram_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_join_requests_user ON join_requests(telegram_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status ON join_requests(status);

CREATE TABLE IF NOT EXISTS job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 10,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    reserved_at TEXT,
    last_error TEXT,
    run_after TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_run ON job_queue(status, run_after);
CREATE INDEX IF NOT EXISTS idx_job_queue_type ON job_queue(job_type);

CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message_text TEXT NOT NULL,
    photo_url TEXT,
    button_text TEXT,
    button_url TEXT,
    target_segment TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    scheduled_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    total_target INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    blocked_count INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL,
    telegram_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    telegram_message_id TEXT,
    error_message TEXT,
    sent_at TEXT,
    UNIQUE(broadcast_id, telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_status ON broadcast_recipients(broadcast_id, status);

CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT,
    admin_name TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS funnel_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    campaign_source TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_funnel_event ON funnel_events(event_name);
CREATE INDEX IF NOT EXISTS idx_funnel_user ON funnel_events(telegram_id);
