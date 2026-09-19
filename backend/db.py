"""SQLite schema, seed data, and connection helpers for the rehab portal."""
import os
import sqlite3
from datetime import datetime, timedelta

from import_datasets import import_clinic_datasets

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(ROOT, "rehab_cloud.db")

DOCTOR_ID = "DOC-RM-001"
DOCTOR_NAME = "Dr. Rohan Mehta"

# Ten caseload patients — varied recovery stages, deliberately spread across range
# (target_progress, n_sessions)  — kept low/mid intentionally for realism
PATIENTS = [
    ("PT-048219", "Ananya Patel",    "ACL reconstruction",     38, 4),
    ("PT-036580", "Vikram Shah",     "Shoulder mobility",      22, 3),
    ("PT-052014", "Meera Iyer",      "Post-stroke mobility",   15, 2),
    ("PT-041776", "Arjun Menon",     "Hip rehabilitation",     45, 5),
    ("PT-061102", "Kavita Desai",    "Knee osteoarthritis",    19, 3),
    ("PT-027441", "Ramesh Khanna",   "Hip fracture recovery",  12, 2),
    ("PT-055890", "Sneha Kapoor",    "Ankle sprain",           52, 5),
    ("PT-033017", "Imran Qureshi",   "Rotator cuff repair",    31, 4),
    ("PT-019334", "Priya Nambiar",   "ACL reconstruction",     9, 2),
    ("PT-044208", "Thomas Varghese", "Meniscus repair",        41, 4),
]

# Exercise prescriptions per level — stored per session
_EXERCISES = {
    1: [
        "Passive ROM assisted by therapist — 3 × 10 reps",
        "Ice application 15 min post-session",
        "Isometric quadriceps sets (pain-free range only)",
        "Non-weight-bearing heel slides",
        "Deep breathing & relaxation exercises",
    ],
    2: [
        "Resistance band knee flexion — 3 × 12 reps",
        "Partial weight-bearing single-leg stance (30 s × 3)",
        "Mini-squat progression (0–45°) — 3 × 15 reps",
        "Step-up training on 10 cm block — 2 × 10 reps",
        "Stationary bike — 15 min low resistance",
    ],
    3: [
        "Dynamic plyometric jump landings — 3 × 8 reps",
        "Full squat to 90° with load — 3 × 12 reps",
        "Agility ladder drills — 4 × 30 s",
        "Sport-specific movement patterns",
        "Jogging / running progression on treadmill",
    ],
}

def exercises_for_score(score, pain):
    """Return the exercise list as a JSON-serialisable string for a given score/pain."""
    import json
    if score < 40 or pain >= 7:
        level, title = 1, "Level 1 — Gentle Mobilization & Rest"
    elif score < 75:
        level, title = 2, "Level 2 — Active Recovery & Resistance Band Flexion"
    else:
        level, title = 3, "Level 3 — Full Functional Conditioning & Dynamic Plyometrics"
    return json.dumps({"level": level, "title": title, "exercises": _EXERCISES[level]})

# Portal credentials — username (lowercase) → (password, role, patient_id or None)
CREDENTIALS = {
    # Doctor
    "doctor":         ("doctor123", "doctor", None),
    # Patients — username is firstname (lowercase), password is 1234 for all
    "ananya":         ("1234", "patient", "PT-048219"),
    "vikram":         ("1234", "patient", "PT-036580"),
    "meera":          ("1234", "patient", "PT-052014"),
    "arjun":          ("1234", "patient", "PT-041776"),
    "kavita":         ("1234", "patient", "PT-061102"),
    "ramesh":         ("1234", "patient", "PT-027441"),
    "sneha":          ("1234", "patient", "PT-055890"),
    "imran":          ("1234", "patient", "PT-033017"),
    "priya":          ("1234", "patient", "PT-019334"),
    "thomas":         ("1234", "patient", "PT-044208"),
}


def connect():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def progress_from_metrics(pain, flexion, extension, balance):
    """Composite mobility score from the four charted clinical values."""
    pain = max(0, min(10, int(pain)))
    flexion = max(0, min(140, int(flexion)))
    extension = max(0, min(20, int(extension)))
    balance = max(0, min(100, int(balance)))
    score = (
        0.30 * (flexion / 140 * 100)
        + 0.20 * ((20 - extension) / 20 * 100)
        + 0.30 * balance
        + 0.20 * ((10 - pain) / 10 * 100)
    )
    return max(0, min(100, round(score)))


def _metrics_for_progress(target, session_index, session_count):
    """Build a plausible assessment that lands near `target` progress."""
    t = session_index / max(session_count - 1, 1)
    start = max(12, target - 40)
    p = start + (target - start) * t
    pain = max(1, min(9, round(8.2 - p * 0.06)))
    flexion = max(40, min(140, round(55 + p * 0.78)))
    extension = max(0, min(18, round(14 - p * 0.12)))
    balance = max(20, min(100, round(28 + p * 0.68)))
    return pain, flexion, extension, balance


def init_db():
    conn = connect()
    c = conn.cursor()
    cols = [r[1] for r in c.execute("PRAGMA table_info(patients)").fetchall()]
    if cols and "name" not in cols:
        conn.close()
        os.remove(DB_FILE)
        conn = connect()
        c = conn.cursor()

    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS doctors (
            doctor_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            specialty TEXT
        );
        CREATE TABLE IF NOT EXISTS patients (
            patient_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            diagnosis TEXT,
            assigned_doctor TEXT
        );
        CREATE TABLE IF NOT EXISTS rehab_programs (
            program_id TEXT PRIMARY KEY,
            patient_id TEXT NOT NULL,
            program_name TEXT,
            start_date TEXT,
            status TEXT,
            progress_score INTEGER,
            FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
        );
        CREATE TABLE IF NOT EXISTS rehab_sessions (
            session_id TEXT PRIMARY KEY,
            program_id TEXT NOT NULL,
            doctor_id TEXT,
            session_date TEXT,
            session_number INTEGER,
            status TEXT,
            FOREIGN KEY (program_id) REFERENCES rehab_programs(program_id)
        );
        CREATE TABLE IF NOT EXISTS rehab_assessments (
            assessment_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL UNIQUE,
            pain_level INTEGER,
            rom_flexion INTEGER,
            rom_extension INTEGER,
            strength_left INTEGER DEFAULT 0,
            strength_right INTEGER DEFAULT 0,
            balance_score INTEGER,
            speech_clarity TEXT DEFAULT 'N/A',
            response_time TEXT DEFAULT 'N/A',
            therapist_notes TEXT,
            recommendation TEXT DEFAULT '',
            patient_feedback TEXT,
            exercises TEXT DEFAULT '',
            FOREIGN KEY (session_id) REFERENCES rehab_sessions(session_id)
        );
        CREATE TABLE IF NOT EXISTS research_metrics (
            metric_id INTEGER PRIMARY KEY AUTOINCREMENT,
            assessment_id TEXT,
            gpu_layers INTEGER,
            latency_asr_ms INTEGER,
            latency_llm_ms INTEGER,
            latency_db_ms INTEGER,
            cfnr_rate REAL
        );
        """
    )

    import_clinic_datasets(conn)

    c.execute("SELECT COUNT(*) FROM patients")
    if c.fetchone()[0] > 0:
        conn.commit()
        conn.close()
        return

    c.execute(
        "INSERT INTO doctors VALUES (?, ?, ?)",
        (DOCTOR_ID, DOCTOR_NAME, "Physiotherapist · Orthopedics"),
    )

    now = datetime(2026, 9, 4, 10, 0, 0)
    for pid, name, diagnosis, target, n_sessions in PATIENTS:
        c.execute(
            "INSERT INTO patients VALUES (?, ?, ?, ?)",
            (pid, name, diagnosis, DOCTOR_NAME),
        )
        program_id = f"PRG-{pid}"
        start = now - timedelta(days=10 * n_sessions)
        c.execute(
            "INSERT INTO rehab_programs VALUES (?, ?, ?, ?, ?, ?)",
            (
                program_id,
                pid,
                diagnosis,
                start.strftime("%Y-%m-%d %H:%M:%S"),
                "Active",
                0,
            ),
        )
        last_metrics = None
        for i in range(1, n_sessions + 1):
            pain, flex, ext, bal = _metrics_for_progress(target, i - 1, n_sessions)
            last_metrics = (pain, flex, ext, bal)
            session_date = start + timedelta(days=10 * (i - 1), hours=i)
            session_id = f"SES-{pid}-{i}"
            c.execute(
                "INSERT INTO rehab_sessions VALUES (?, ?, ?, ?, ?, ?)",
                (
                    session_id,
                    program_id,
                    DOCTOR_ID,
                    session_date.strftime("%Y-%m-%d %H:%M:%S"),
                    i,
                    "Completed",
                ),
            )
            notes = (
                f"Session {i}: controlled loading. Pain {pain}/10, "
                f"flexion {flex}°, extension lag {ext}°, balance {bal}."
            )
            feedback = (
                "Feeling stronger this week."
                if i > n_sessions // 2
                else "Still cautious on stairs and turns."
            )
            c.execute(
                """INSERT INTO rehab_assessments (
                    assessment_id, session_id, pain_level, rom_flexion, rom_extension,
                    balance_score, therapist_notes, patient_feedback, exercises
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"ASSESS-{session_id}", session_id, pain, flex, ext, bal, notes, feedback,
                 exercises_for_score(progress_from_metrics(pain, flex, ext, bal), pain)),
            )
        score = progress_from_metrics(*last_metrics)
        c.execute(
            "UPDATE rehab_programs SET progress_score = ? WHERE program_id = ?",
            (score, program_id),
        )

    conn.commit()
    conn.close()
