import csv
import io
import json
import os
import sys
import uuid
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import DOCTOR_ID, DB_FILE, CREDENTIALS, connect, init_db, progress_from_metrics, exercises_for_score

PORT = 8000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")

# ---------------------------------------------------------------------------
# Paper-accurate GPU offloading simulation data (Table 3, IEEE Access 2026)
# ---------------------------------------------------------------------------
_TELEMETRY = {
    0: {
        "gpu_layers": 0,
        "mode": "CPU-Only",
        "latency_asr_ms": 3200,
        "latency_llm_ms": 6800,
        "latency_db_ms": 800,
        "latency_total_ms": 10800,
        "svr": 1.0,
        "cfnr": 0.0,
        "safety_alert": False,
        "note": "Fully deterministic. No critical-field null events observed.",
    },
    20: {
        "gpu_layers": 20,
        "mode": "Intermediate (20 layers)",
        "latency_asr_ms": 3600,
        "latency_llm_ms": 6900,
        "latency_db_ms": 800,
        "latency_total_ms": 11300,
        "svr": 1.0,
        "cfnr": 0.0,
        "safety_alert": False,
        "note": "PCIe bus contention increases total latency slightly. Schema intact.",
    },
    30: {
        "gpu_layers": 30,
        "mode": "Aggressive (30 layers)",
        "latency_asr_ms": 2100,
        "latency_llm_ms": 5600,
        "latency_db_ms": 800,
        "latency_total_ms": 8500,
        "svr": 0.0,
        "cfnr": 1.0,
        "safety_alert": True,
        "note": "100% Critical-Field Null Rate. Clinical fields (lesion, edad, actividad) are null. "
                "Deterministic Rule Engine isolated — exercise protocol unaffected.",
    },
}


class ClinicalAPIHandler(SimpleHTTPRequestHandler):
    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith("/api/"):
            self.handle_api_get(path, query)
            return
        self.serve_frontend(path)

    def handle_api_get(self, path, query):
        conn = connect()
        c = conn.cursor()
        try:
            # ----------------------------------------------------------------
            # Rehab patients list
            # ----------------------------------------------------------------
            if path.startswith("/api/patients"):
                c.execute(
                    """
                    SELECT p.patient_id, p.name, p.diagnosis, p.assigned_doctor,
                           IFNULL(r.progress_score, 0) AS progress_score,
                           r.program_name, r.program_id, r.start_date
                    FROM patients p
                    LEFT JOIN rehab_programs r ON p.patient_id = r.patient_id
                        AND r.status = 'Active'
                    ORDER BY p.name
                    """
                )
                self.send_json([dict(r) for r in c.fetchall()])

            # ----------------------------------------------------------------
            # Doctors list
            # ----------------------------------------------------------------
            elif path == "/api/doctors":
                c.execute("SELECT * FROM doctors")
                self.send_json([dict(r) for r in c.fetchall()])

            # ----------------------------------------------------------------
            # Rehab session timeline for one patient
            # ----------------------------------------------------------------
            elif path == "/api/rehab/timeline":
                pid = query.get("patient_id", [None])[0]
                if not pid:
                    self.send_json({"error": "patient_id required"}, 400)
                    return
                c.execute(
                    """
                    SELECT * FROM rehab_programs
                    WHERE patient_id = ? AND status = 'Active'
                    ORDER BY start_date DESC LIMIT 1
                    """,
                    (pid,),
                )
                prog = c.fetchone()
                if not prog:
                    c.execute("SELECT * FROM patients WHERE patient_id = ?", (pid,))
                    patient = c.fetchone()
                    self.send_json(
                        {
                            "patient": dict(patient) if patient else None,
                            "program": None,
                            "sessions": [],
                        }
                    )
                    return
                prog_dict = dict(prog)
                c.execute("SELECT * FROM patients WHERE patient_id = ?", (pid,))
                patient = c.fetchone()
                c.execute(
                    """
                    SELECT s.*, a.pain_level, a.rom_flexion, a.rom_extension,
                           a.strength_left, a.strength_right, a.balance_score,
                           a.speech_clarity, a.response_time, a.therapist_notes,
                           a.recommendation, a.patient_feedback, a.exercises
                    FROM rehab_sessions s
                    LEFT JOIN rehab_assessments a ON s.session_id = a.session_id
                    WHERE s.program_id = ?
                    ORDER BY s.session_number ASC
                    """,
                    (prog_dict["program_id"],),
                )
                self.send_json(
                    {
                        "patient": dict(patient) if patient else None,
                        "program": prog_dict,
                        "sessions": [dict(r) for r in c.fetchall()],
                    }
                )

            # ----------------------------------------------------------------
            # GPU telemetry simulator (paper Table 3)
            # ----------------------------------------------------------------
            elif path == "/api/telemetry":
                try:
                    layers = int(query.get("gpu_layers", [0])[0])
                except (ValueError, TypeError):
                    layers = 0
                # Snap to nearest valid value (0, 20, 30)
                nearest = min(_TELEMETRY.keys(), key=lambda k: abs(k - layers))
                self.send_json(_TELEMETRY[nearest])

            # ----------------------------------------------------------------
            # Export patient session history as CSV
            # ----------------------------------------------------------------
            elif path == "/api/rehab/export":
                pid = query.get("patient_id", [None])[0]
                if not pid:
                    self.send_json({"error": "patient_id required"}, 400)
                    return
                c.execute("SELECT * FROM patients WHERE patient_id = ?", (pid,))
                patient = c.fetchone()
                c.execute(
                    """
                    SELECT s.session_number, s.session_date, s.status,
                           a.pain_level, a.rom_flexion, a.rom_extension,
                           a.balance_score, a.therapist_notes, a.patient_feedback
                    FROM rehab_sessions s
                    LEFT JOIN rehab_assessments a ON s.session_id = a.session_id
                    JOIN rehab_programs r ON r.program_id = s.program_id
                    WHERE r.patient_id = ? AND r.status = 'Active'
                    ORDER BY s.session_number ASC
                    """,
                    (pid,),
                )
                rows = c.fetchall()
                buf = io.StringIO()
                writer = csv.writer(buf)
                writer.writerow([
                    "Session", "Date", "Status", "Pain (0-10)",
                    "ROM Flexion (°)", "ROM Extension (°)", "Balance (0-100)",
                    "Therapist Notes", "Patient Feedback"
                ])
                for r in rows:
                    writer.writerow(list(r))
                csv_bytes = buf.getvalue().encode("utf-8")
                pname = dict(patient)["name"].replace(" ", "_") if patient else pid
                filename = f"rehab_{pname}_{pid}.csv"
                self.send_response(200)
                self.send_cors_headers()
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(csv_bytes)))
                self.end_headers()
                self.wfile.write(csv_bytes)

            # ----------------------------------------------------------------
            # Caseload analytics — per-patient latest metrics + progress
            # ----------------------------------------------------------------
            elif path == "/api/analytics/caseload":
                c.execute(
                    """
                    SELECT p.patient_id, p.name, p.diagnosis,
                           IFNULL(r.progress_score, 0) AS progress_score,
                           r.program_name,
                           (SELECT a.pain_level FROM rehab_sessions s2
                            JOIN rehab_assessments a ON s2.session_id = a.session_id
                            WHERE s2.program_id = r.program_id
                            ORDER BY s2.session_number DESC LIMIT 1) AS latest_pain,
                           (SELECT a.rom_flexion FROM rehab_sessions s2
                            JOIN rehab_assessments a ON s2.session_id = a.session_id
                            WHERE s2.program_id = r.program_id
                            ORDER BY s2.session_number DESC LIMIT 1) AS latest_flexion,
                           (SELECT a.balance_score FROM rehab_sessions s2
                            JOIN rehab_assessments a ON s2.session_id = a.session_id
                            WHERE s2.program_id = r.program_id
                            ORDER BY s2.session_number DESC LIMIT 1) AS latest_balance,
                           (SELECT COUNT(*) FROM rehab_sessions s2
                            WHERE s2.program_id = r.program_id) AS session_count
                    FROM patients p
                    LEFT JOIN rehab_programs r ON p.patient_id = r.patient_id
                        AND r.status = 'Active'
                    ORDER BY p.name
                    """
                )
                self.send_json([dict(r) for r in c.fetchall()])

            # ----------------------------------------------------------------
            # Clinic data endpoints
            # ----------------------------------------------------------------
            elif path == "/api/clinic/patients":
                c.execute(
                    """SELECT patient_id, first_name, last_name,
                              first_name || ' ' || last_name AS name,
                              gender, date_of_birth, contact_number, address,
                              insurance_provider, email
                       FROM clinic_patients ORDER BY last_name, first_name"""
                )
                self.send_json([dict(r) for r in c.fetchall()])
            elif path == "/api/clinic/doctors":
                c.execute(
                    """SELECT doctor_id, first_name, last_name,
                              first_name || ' ' || last_name AS name,
                              specialization, phone_number, years_experience,
                              hospital_branch, email
                       FROM clinic_doctors ORDER BY specialization, last_name"""
                )
                self.send_json([dict(r) for r in c.fetchall()])
            elif path == "/api/clinic/directory":
                c.execute(
                    """SELECT doctor_name, specialty FROM specialist_directory
                       ORDER BY specialty, doctor_name"""
                )
                self.send_json([dict(r) for r in c.fetchall()])
            elif path == "/api/clinic/appointments":
                pid = query.get("patient_id", [None])[0]
                sql = """
                    SELECT a.*, p.first_name || ' ' || p.last_name AS patient_name,
                           d.first_name || ' ' || d.last_name AS doctor_name,
                           d.specialization, d.hospital_branch
                    FROM clinic_appointments a
                    JOIN clinic_patients p ON p.patient_id = a.patient_id
                    JOIN clinic_doctors d ON d.doctor_id = a.doctor_id
                """
                params = []
                if pid:
                    sql += " WHERE a.patient_id = ?"
                    params.append(pid)
                sql += " ORDER BY a.appointment_date DESC, a.appointment_time DESC"
                c.execute(sql, params)
                self.send_json([dict(r) for r in c.fetchall()])
            elif path == "/api/clinic/treatments":
                pid = query.get("patient_id", [None])[0]
                sql = """
                    SELECT t.*, a.patient_id, a.reason_for_visit,
                           p.first_name || ' ' || p.last_name AS patient_name
                    FROM clinic_treatments t
                    JOIN clinic_appointments a ON a.appointment_id = t.appointment_id
                    JOIN clinic_patients p ON p.patient_id = a.patient_id
                """
                params = []
                if pid:
                    sql += " WHERE a.patient_id = ?"
                    params.append(pid)
                sql += " ORDER BY t.treatment_date DESC"
                c.execute(sql, params)
                self.send_json([dict(r) for r in c.fetchall()])
            elif path == "/api/clinic/bills":
                pid = query.get("patient_id", [None])[0]
                sql = """
                    SELECT b.*, t.treatment_type, t.description,
                           p.first_name || ' ' || p.last_name AS patient_name
                    FROM clinic_bills b
                    LEFT JOIN clinic_treatments t ON t.treatment_id = b.treatment_id
                    LEFT JOIN clinic_patients p ON p.patient_id = b.patient_id
                """
                params = []
                if pid:
                    sql += " WHERE b.patient_id = ?"
                    params.append(pid)
                sql += " ORDER BY b.bill_date DESC"
                c.execute(sql, params)
                self.send_json([dict(r) for r in c.fetchall()])
            elif path == "/api/clinic/admissions":
                pid = query.get("patient_id", [None])[0]
                if pid:
                    n = conn.execute("SELECT COUNT(*) FROM hospital_admissions").fetchone()[0]
                    digits = "".join(ch for ch in pid if ch.isdigit()) or "1"
                    offset = (int(digits) - 1) % max(n, 1) if n else 0
                    c.execute(
                        "SELECT * FROM hospital_admissions ORDER BY admission_id LIMIT 8 OFFSET ?",
                        (offset,),
                    )
                else:
                    c.execute(
                        "SELECT * FROM hospital_admissions ORDER BY admission_date DESC LIMIT 40"
                    )
                self.send_json([dict(r) for r in c.fetchall()])
            elif path == "/api/clinic/summary":
                def one(sql):
                    return c.execute(sql).fetchone()[0]

                self.send_json(
                    {
                        "patients": one("SELECT COUNT(*) FROM clinic_patients"),
                        "doctors": one("SELECT COUNT(*) FROM clinic_doctors"),
                        "appointments": one("SELECT COUNT(*) FROM clinic_appointments"),
                        "scheduled": one(
                            "SELECT COUNT(*) FROM clinic_appointments WHERE status = 'Scheduled'"
                        ),
                        "treatments": one("SELECT COUNT(*) FROM clinic_treatments"),
                        "bills": one("SELECT COUNT(*) FROM clinic_bills"),
                        "pending_bills": one(
                            "SELECT COUNT(*) FROM clinic_bills WHERE payment_status = 'Pending'"
                        ),
                        "admissions": one("SELECT COUNT(*) FROM hospital_admissions"),
                        "rehab_patients": one("SELECT COUNT(*) FROM patients"),
                    }
                )
            else:
                self.send_json({"error": "Not found"}, 404)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)
        finally:
            conn.close()

    def do_POST(self):
        # ----------------------------------------------------------------
        # GPU Assessment (Step 1) — simulate without saving to DB
        # ----------------------------------------------------------------
        if self.path == "/api/rehab/gpu-assess":
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            pain       = int(data.get("pain_level", 0))
            flexion    = int(data.get("rom_flexion", 0))
            extension  = int(data.get("rom_extension", 0))
            balance    = int(data.get("balance_score", 0))
            notes      = data.get("therapist_notes", "")
            gpu_layers = int(data.get("gpu_layers", 0))
            score = progress_from_metrics(pain, flexion, extension, balance)
            tele = _TELEMETRY.get(min(_TELEMETRY.keys(), key=lambda k: abs(k - gpu_layers)))
            cfnr_triggered = tele["cfnr"] >= 1.0
            if cfnr_triggered:
                semantic_json = {k: None for k in ["lesion","edad","actividad","dolor","rango_flexion","rango_extension","equilibrio","estado_animo","confianza_hablando","frase_motivadora"]}
                svr, cfnr, cr, cfa = 1.0, 1.0, 0.25, 0.0
            else:
                activity_label = "high" if balance >= 70 else "moderate" if balance >= 40 else "low"
                lesion_text = notes.strip() or "musculoskeletal rehabilitation"
                if len(lesion_text) > 80:
                    lesion_text = lesion_text[:80].rsplit(" ", 1)[0] + "…"
                semantic_json = {
                    "lesion": lesion_text, "edad": 35, "actividad": activity_label,
                    "dolor": pain, "rango_flexion": flexion, "rango_extension": extension,
                    "equilibrio": balance,
                    "estado_animo": "positive" if pain <= 4 else "guarded",
                    "confianza_hablando": "moderate",
                    "frase_motivadora": "Progressing well — keep up the momentum." if score >= 60 else "Every session counts — you are on the right track.",
                }
                svr, cfnr, cr, cfa = 1.0, 0.0, 1.0, 1.0
            self.send_json({
                "progress_score": score,
                "semantic": {
                    "gpu_layers": tele["gpu_layers"], "mode": tele["mode"],
                    "json_output": semantic_json,
                    "svr": svr, "cfnr": cfnr, "cr": cr, "critical_field_accuracy": cfa,
                    "safety_alert": cfnr_triggered,
                    "latency_asr_ms": tele["latency_asr_ms"],
                    "latency_llm_ms": tele["latency_llm_ms"],
                    "latency_db_ms": tele["latency_db_ms"],
                    "latency_total_ms": tele["latency_total_ms"],
                    "note": tele["note"],
                },
            })
            return

        # ----------------------------------------------------------------
        # Login / credential validation
        # ----------------------------------------------------------------
        if self.path == "/api/auth/login":
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            username = (data.get("username") or "").strip().lower()
            password = (data.get("password") or "").strip()
            role_hint = (data.get("role") or "").strip().lower()
            cred = CREDENTIALS.get(username)
            if not cred or cred[0] != password:
                self.send_json({"error": "Invalid username or password."}, 401)
                return
            _, cred_role, patient_id = cred
            # role_hint must match stored role
            if role_hint and role_hint != cred_role:
                self.send_json({"error": f"This account is a {cred_role} account."}, 401)
                return
            # Resolve display name
            if cred_role == "doctor":
                display_name = "Dr. Rohan Mehta"
            else:
                conn = connect()
                row = conn.execute(
                    "SELECT name FROM patients WHERE patient_id = ?", (patient_id,)
                ).fetchone()
                conn.close()
                display_name = row["name"] if row else username.replace(".", " ").title()
            self.send_json({
                "status": "ok",
                "role": cred_role,
                "patient_id": patient_id,
                "display_name": display_name,
            })
            return

        # ----------------------------------------------------------------
        # Doctor remarks + manual progress override
        # ----------------------------------------------------------------
        if self.path == "/api/rehab/remarks":
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            patient_id = data.get("patient_id")
            session_id = data.get("session_id")
            remarks = data.get("remarks", "").strip()
            new_progress = data.get("progress_override")
            if not patient_id or not session_id:
                self.send_json({"error": "patient_id and session_id required"}, 400)
                return
            conn = connect()
            c = conn.cursor()
            try:
                # Update the therapist recommendation field in the assessment
                c.execute(
                    """UPDATE rehab_assessments SET recommendation = ?
                       WHERE session_id = ?""",
                    (remarks, session_id),
                )
                # If doctor provided a manual progress override, apply it
                if new_progress is not None:
                    pct = max(0, min(100, int(new_progress)))
                    c.execute(
                        """UPDATE rehab_programs SET progress_score = ?
                           WHERE patient_id = ? AND status = 'Active'""",
                        (pct, patient_id),
                    )
                conn.commit()
                # Return the confirmed progress value
                row = c.execute(
                    """SELECT progress_score FROM rehab_programs
                       WHERE patient_id = ? AND status = 'Active'""",
                    (patient_id,),
                ).fetchone()
                self.send_json({
                    "status": "ok",
                    "progress_score": row["progress_score"] if row else new_progress,
                })
            except Exception as e:
                conn.rollback()
                self.send_json({"error": str(e)}, 500)
            finally:
                conn.close()
            return

        if self.path != "/api/rehab/assessment":
            self.send_json({"error": "Not found"}, 404)
            return

        length = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(length).decode("utf-8"))

        patient_id = data.get("patient_id")
        if not patient_id:
            self.send_json({"error": "patient_id required"}, 400)
            return

        doctor_id = data.get("doctor_id") or DOCTOR_ID
        pain = int(data.get("pain_level", 0))
        flexion = int(data.get("rom_flexion", 0))
        extension = int(data.get("rom_extension", 0))
        balance = int(data.get("balance_score", 0))
        notes = data.get("therapist_notes", "")
        feedback = data.get("patient_feedback", "")
        gpu_layers = int(data.get("gpu_layers", 0))
        score = progress_from_metrics(pain, flexion, extension, balance)

        # ----------------------------------------------------------------
        # Simulate the paper's ASR → LLM semantic extraction pipeline
        # (IEEE Access 2026, Table 4 — phi-3-mini Q4_K_S on Jetson Orin Nano)
        # GPU Layers = 0 or 20 → full extraction, CFNR = 0
        # GPU Layers = 30     → CFNR = 100%, all critical fields null
        # ----------------------------------------------------------------
        tele = _TELEMETRY.get(
            min(_TELEMETRY.keys(), key=lambda k: abs(k - gpu_layers))
        )
        cfnr_triggered = tele["cfnr"] >= 1.0

        # Map clinical inputs to the paper's JSON schema field names
        # lesion = injury/diagnosis derived from notes or diagnosis field
        # edad   = patient age (estimated from context; demo uses fixed 35)
        # actividad = activity level derived from balance + functional score
        if cfnr_triggered:
            # GPU Layers = 30: memory contention → all critical fields null
            # JSON structure valid (SVR=100%) but fields empty (CFNR=100%)
            semantic_json = {
                "lesion": None,
                "edad": None,
                "actividad": None,
                "dolor": None,
                "rango_flexion": None,
                "rango_extension": None,
                "equilibrio": None,
                "estado_animo": None,
                "confianza_hablando": None,
                "frase_motivadora": None,
            }
            svr = 1.0   # JSON structure is syntactically valid
            cfnr = 1.0
            cr = 0.25   # only 1 of 4 optional fields incidentally populated
            cfa = 0.0   # 0% critical-field accuracy
        else:
            # GPU Layers = 0 / 20: full stable extraction
            activity_label = (
                "high" if balance >= 70 else
                "moderate" if balance >= 40 else
                "low"
            )
            lesion_text = notes.strip() or "musculoskeletal rehabilitation"
            # Extract first meaningful sentence from therapist notes
            if len(lesion_text) > 80:
                lesion_text = lesion_text[:80].rsplit(" ", 1)[0] + "…"
            semantic_json = {
                "lesion": lesion_text,
                "edad": 35,         # demo fixed age (paper used calibration audio)
                "actividad": activity_label,
                "dolor": pain,
                "rango_flexion": flexion,
                "rango_extension": extension,
                "equilibrio": balance,
                "estado_animo": "positive" if pain <= 4 else "guarded",
                "confianza_hablando": "moderate",
                "frase_motivadora": (
                    "Progressing well — keep up the momentum."
                    if score >= 60 else
                    "Every session counts — you are on the right track."
                ),
            }
            svr = 1.0
            cfnr = 0.0
            cr = 1.0
            cfa = 1.0

        conn = connect()
        c = conn.cursor()
        try:
            c.execute(
                """SELECT program_id FROM rehab_programs
                   WHERE patient_id = ? AND status = 'Active'""",
                (patient_id,),
            )
            prog = c.fetchone()
            if prog:
                program_id = prog[0]
            else:
                program_id = f"PRG-{patient_id}-{uuid.uuid4().hex[:4]}"
                c.execute(
                    "INSERT INTO rehab_programs VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        program_id,
                        patient_id,
                        "General Rehabilitation",
                        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "Active",
                        0,
                    ),
                )

            c.execute(
                "SELECT MAX(session_number) FROM rehab_sessions WHERE program_id = ?",
                (program_id,),
            )
            sess_num = (c.fetchone()[0] or 0) + 1
            session_id = f"SES-{program_id}-{sess_num}-{uuid.uuid4().hex[:4]}"
            c.execute(
                "INSERT INTO rehab_sessions VALUES (?, ?, ?, ?, ?, ?)",
                (
                    session_id,
                    program_id,
                    doctor_id,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    sess_num,
                    "Completed",
                ),
            )
            assessment_id = f"ASSESS-{session_id}"
            ex_json = exercises_for_score(score, pain)
            c.execute(
                """INSERT INTO rehab_assessments (
                    assessment_id, session_id, pain_level, rom_flexion, rom_extension,
                    balance_score, therapist_notes, patient_feedback, exercises
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    assessment_id,
                    session_id,
                    pain,
                    flexion,
                    extension,
                    balance,
                    notes,
                    feedback,
                    ex_json,
                ),
            )
            c.execute(
                "UPDATE rehab_programs SET progress_score = ? WHERE program_id = ?",
                (score, program_id),
            )
            conn.commit()
            self.send_json(
                {
                    "status": "success",
                    "session_id": session_id,
                    "progress_score": score,
                    # ── Semantic extraction pipeline results ──────────────
                    "semantic": {
                        "gpu_layers": tele["gpu_layers"],
                        "mode": tele["mode"],
                        "json_output": semantic_json,
                        "svr": svr,
                        "cfnr": cfnr,
                        "cr": cr,
                        "critical_field_accuracy": cfa,
                        "safety_alert": cfnr_triggered,
                        "latency_asr_ms": tele["latency_asr_ms"],
                        "latency_llm_ms": tele["latency_llm_ms"],
                        "latency_db_ms": tele["latency_db_ms"],
                        "latency_total_ms": tele["latency_total_ms"],
                        "note": tele["note"],
                    },
                },
                201,
            )
        except Exception as e:
            conn.rollback()
            self.send_json({"error": str(e)}, 500)
        finally:
            conn.close()

    def serve_frontend(self, path):
        # Resolve requested path to a file inside FRONTEND only
        if path in ("/", "/index.html"):
            filepath = os.path.join(FRONTEND, "index.html")
        else:
            # Strip leading slash, normalise, reject anything that escapes root
            rel = os.path.normpath(path.lstrip("/"))
            if rel.startswith("..") or os.path.isabs(rel):
                self.send_error(403)
                return
            filepath = os.path.join(FRONTEND, rel)
            # Fall back to basename only (flat frontend directory)
            if not os.path.isfile(filepath):
                filepath = os.path.join(FRONTEND, os.path.basename(rel))

        if not os.path.isfile(filepath):
            self.send_error(404)
            return

        # Final safety check: resolved path must still be inside FRONTEND
        if not os.path.realpath(filepath).startswith(os.path.realpath(FRONTEND)):
            self.send_error(403)
            return

        ext = os.path.splitext(filepath)[1].lower()
        types = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
        }
        self.send_response(200)
        self.send_header("Content-type", types.get(ext, "application/octet-stream"))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with open(filepath, "rb") as f:
            self.wfile.write(f.read())

    def send_json(self, data, status=200):
        payload = json.dumps(data, default=str).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    init_db()
    os.chdir(ROOT)

    # Use PORT from environment variable for cloud deployment, fallback to 8000
    port = int(os.environ.get("PORT", PORT))

    # Bind to 0.0.0.0 for cloud deployment (allows external access)
    host = os.environ.get("HOST", "0.0.0.0")

    ThreadingHTTPServer.allow_reuse_address = True
    with ThreadingHTTPServer((host, port), ClinicalAPIHandler) as httpd:
        print(f"Northstar portal: http://{host}:{port}", flush=True)
        print(f"Database: {DB_FILE}", flush=True)
        httpd.serve_forever()
