"""Load hospital CSVs from Downloads into SQLite. Original files are never modified."""
import csv
import os
from urllib.parse import parse_qs, urlparse, unquote

# Use relative path for cloud deployment - falls back to local Downloads for dev
DOWNLOADS = os.path.join(os.path.dirname(__file__), "data")
if not os.path.exists(DOWNLOADS):
    # Fallback to local Downloads folder for development
    DOWNLOADS = os.path.expanduser("~/Downloads")
    if os.name == 'nt':  # Windows
        DOWNLOADS = r"C:\Users\prave\Downloads"

HEALTHCARE_ADMISSION_LIMIT = 80


def _path(name):
    return os.path.join(DOWNLOADS, name)


def _open(name):
    path = _path(name)
    if not os.path.isfile(path):
        return None
    return open(path, newline="", encoding="utf-8-sig")


def _title(value):
    return " ".join(str(value or "").split()).title()


def _specialty_from_url(url):
    qs = parse_qs(urlparse(url).query)
    raw = (qs.get("specialization") or [""])[0]
    return unquote(raw).replace("%20", " ") or "General"


def _parse_local_name(raw):
    text = str(raw or "").strip().strip('"')
    text = text.replace("Mr.", "").replace("Miss.", "").replace("Mrs.", "")
    parts = [p.strip() for p in text.split(",") if p.strip()]
    if len(parts) >= 2:
        return f"{parts[0]} {parts[1]}"
    return text.replace(",", " ").strip()


def create_clinic_tables(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS clinic_patients (
            patient_id TEXT PRIMARY KEY,
            first_name TEXT,
            last_name TEXT,
            gender TEXT,
            date_of_birth TEXT,
            contact_number TEXT,
            address TEXT,
            registration_date TEXT,
            insurance_provider TEXT,
            insurance_number TEXT,
            email TEXT
        );
        CREATE TABLE IF NOT EXISTS clinic_doctors (
            doctor_id TEXT PRIMARY KEY,
            first_name TEXT,
            last_name TEXT,
            specialization TEXT,
            phone_number TEXT,
            years_experience INTEGER,
            hospital_branch TEXT,
            email TEXT
        );
        CREATE TABLE IF NOT EXISTS clinic_appointments (
            appointment_id TEXT PRIMARY KEY,
            patient_id TEXT,
            doctor_id TEXT,
            appointment_date TEXT,
            appointment_time TEXT,
            reason_for_visit TEXT,
            status TEXT
        );
        CREATE TABLE IF NOT EXISTS clinic_treatments (
            treatment_id TEXT PRIMARY KEY,
            appointment_id TEXT,
            treatment_type TEXT,
            description TEXT,
            cost REAL,
            treatment_date TEXT
        );
        CREATE TABLE IF NOT EXISTS clinic_bills (
            bill_id TEXT PRIMARY KEY,
            patient_id TEXT,
            treatment_id TEXT,
            bill_date TEXT,
            amount REAL,
            payment_method TEXT,
            payment_status TEXT
        );
        CREATE TABLE IF NOT EXISTS specialist_directory (
            doctor_name TEXT,
            specialty TEXT,
            source_url TEXT
        );
        CREATE TABLE IF NOT EXISTS name_pool (
            iq TEXT,
            full_name TEXT
        );
        CREATE TABLE IF NOT EXISTS hospital_admissions (
            admission_id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_name TEXT,
            age INTEGER,
            gender TEXT,
            blood_type TEXT,
            condition TEXT,
            admission_date TEXT,
            doctor_name TEXT,
            hospital_name TEXT,
            insurance_provider TEXT,
            billing_amount REAL,
            room_number TEXT,
            admission_type TEXT,
            discharge_date TEXT,
            medication TEXT,
            test_results TEXT
        );
        """
    )


def import_clinic_datasets(conn):
    create_clinic_tables(conn)
    count = conn.execute("SELECT COUNT(*) FROM clinic_patients").fetchone()[0]
    if count:
        return

    handle = _open("patients.csv")
    if handle:
        with handle as f:
            for row in csv.DictReader(f):
                conn.execute(
                    """INSERT OR REPLACE INTO clinic_patients VALUES
                       (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        row["patient_id"],
                        row["first_name"],
                        row["last_name"],
                        row["gender"],
                        row["date_of_birth"],
                        row["contact_number"],
                        row["address"],
                        row["registration_date"],
                        row["insurance_provider"],
                        row["insurance_number"],
                        row["email"],
                    ),
                )

    handle = _open("doctors.csv")
    if handle:
        with handle as f:
            for row in csv.DictReader(f):
                conn.execute(
                    """INSERT OR REPLACE INTO clinic_doctors VALUES
                       (?,?,?,?,?,?,?,?)""",
                    (
                        row["doctor_id"],
                        row["first_name"],
                        row["last_name"],
                        row["specialization"],
                        row["phone_number"],
                        int(row["years_experience"] or 0),
                        row["hospital_branch"],
                        row["email"],
                    ),
                )

    handle = _open("appointments.csv")
    if handle:
        with handle as f:
            for row in csv.DictReader(f):
                conn.execute(
                    """INSERT OR REPLACE INTO clinic_appointments VALUES
                       (?,?,?,?,?,?,?)""",
                    (
                        row["appointment_id"],
                        row["patient_id"],
                        row["doctor_id"],
                        row["appointment_date"],
                        row["appointment_time"],
                        row["reason_for_visit"],
                        row["status"],
                    ),
                )

    handle = _open("treatments.csv")
    if handle:
        with handle as f:
            for row in csv.DictReader(f):
                conn.execute(
                    """INSERT OR REPLACE INTO clinic_treatments VALUES
                       (?,?,?,?,?,?)""",
                    (
                        row["treatment_id"],
                        row["appointment_id"],
                        row["treatment_type"],
                        row["description"],
                        float(row["cost"] or 0),
                        row["treatment_date"],
                    ),
                )

    handle = _open("billing.csv")
    if handle:
        with handle as f:
            for row in csv.DictReader(f):
                conn.execute(
                    """INSERT OR REPLACE INTO clinic_bills VALUES
                       (?,?,?,?,?,?,?)""",
                    (
                        row["bill_id"],
                        row["patient_id"],
                        row["treatment_id"],
                        row["bill_date"],
                        float(row["amount"] or 0),
                        row["payment_method"],
                        row["payment_status"],
                    ),
                )

    handle = _open("doctors_dataset.csv")
    if handle:
        with handle as f:
            for row in csv.reader(f):
                if len(row) < 2:
                    continue
                conn.execute(
                    "INSERT INTO specialist_directory VALUES (?,?,?)",
                    (row[0].strip(), _specialty_from_url(row[1]), row[1].strip()),
                )

    handle = _open("Names.csv")
    if handle:
        with handle as f:
            for row in csv.DictReader(f):
                conn.execute(
                    "INSERT INTO name_pool VALUES (?,?)",
                    (row.get("iq"), _parse_local_name(row.get("full_name"))),
                )

    handle = _open("healthcare_dataset.csv")
    if handle:
        kept = 0
        with handle as f:
            for row in csv.DictReader(f):
                kind = (row.get("Admission Type") or "").strip()
                if kind not in ("Emergency", "Urgent"):
                    continue
                conn.execute(
                    """INSERT INTO hospital_admissions (
                        patient_name, age, gender, blood_type, condition, admission_date,
                        doctor_name, hospital_name, insurance_provider, billing_amount,
                        room_number, admission_type, discharge_date, medication, test_results
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        _title(row.get("Name")),
                        int(float(row.get("Age") or 0)),
                        row.get("Gender"),
                        row.get("Blood Type"),
                        row.get("Medical Condition"),
                        row.get("Date of Admission"),
                        _title(row.get("Doctor")),
                        row.get("Hospital"),
                        row.get("Insurance Provider"),
                        float(row.get("Billing Amount") or 0),
                        str(row.get("Room Number") or ""),
                        kind,
                        row.get("Discharge Date"),
                        row.get("Medication"),
                        row.get("Test Results"),
                    ),
                )
                kept += 1
                if kept >= HEALTHCARE_ADMISSION_LIMIT:
                    break

    conn.commit()
