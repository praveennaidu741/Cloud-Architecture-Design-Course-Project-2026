# Edge-to-Cloud Hybrid Architecture for Adaptive Healthcare Rehabilitation

> **Technical Architecture & Implementation Document**

---

## 1. Executive Summary & Problem Framing
The foundational research paper assigned to our team (*Reliability of Edge AI in XR-Based Health Data Capture: An Experimental Study on GPU Offloading and Semantic Stability*, IEEE Access 2026) evaluated an isolated, cloud-free edge pipeline running on an NVIDIA Jetson Orin Nano with an XR headset.

### Why We Remodeled It for Enterprise Cloud Architecture
While the research paper provides critical empirical insights into on-device GPU offloading limits, an edge-only system cannot be used directly in modern clinical environments because:
1. **Single Point of Failure**: Patient data stored solely in a local SQLite file on an embedded device risks total loss in case of hardware failure, theft, or corruption.
2. **Lack of Multi-Tenancy & Clinical Collaboration**: Clinicians, physiotherapists, and orthopedic specialists located remotely or across departments cannot access patient progress in real time without cloud synchronization.
3. **No Centralized Fleet Telemetry**: Hospital IT systems cannot detect when edge devices suffer from silent semantic failures (such as the 100% Critical-Field Null Rate identified in the paper).

**Our Solution**: We engineered an **Edge-to-Cloud Hybrid System** where:
* The **Edge / Client Tier** handles physical assessment input, localized data validation, and real-time responsiveness.
* The **Cloud Tier** provides scalable microservices, deterministic longitudinal rehabilitation progression, append-only verifiable EHR storage (SHA-256 hash chains), and a centralized observability pipeline for tracking semantic stability across sessions.

---

## 2. System Architecture & Cloud Service Mapping

```
+-------------------------------------------------------------------------------+
|                       TIER 1: CLIENT & SIMULATION TIER                        |
|   Web-Based Patient & Clinician SPA (HTML5 / Vanilla JS / Plus Jakarta Sans)  |
|   Inputs: Age, Injury, Activity Level, Range of Motion, Reaction Time, Pain   |
+---------------------------------------+---------------------------------------+
                                        | HTTPS / JSON (TLS 1.3)
                                        v
+-------------------------------------------------------------------------------+
|                   TIER 2: CLOUD INGESTION & GATEWAY (AWS)                     |
|   Amazon API Gateway (REST Routing, Rate Limiting, CORS Enforcement)          |
|   AWS Cognito / IAM (Session Token Authentication & Role-Based Access)        |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|               TIER 3: CLOUD MICROSERVICES & COMPUTE (FastAPI / ECS)           |
|                                                                               |
|   [A] Semantic Extraction Subsystem                                           |
|       - Clinical Schema Validation (lesion, edad, actividad, etc.)           |
|       - GPU Offload Simulation (Layers = 0, 20, 30)                           |
|                                                                               |
|   [B] Deterministic Longitudinal Rule Engine (Decoupled from LLM)            |
|       - Evaluates Biomechanical Recovery Score (0-100)                        |
|       - Prescribes Adaptive Protocols (Level 1 Gentle, Level 2, Level 3)     |
|                                                                               |
|   [C] Fleet Telemetry & Semantic Stability Monitor                            |
|       - Latency Decomposition: L_ASR + L_LLM + L_DB = L_TOTAL                 |
|       - Metrics Tracking: SVR (Schema Validity) & CFNR (Null Rate)            |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                 TIER 4: CLOUD PERSISTENCE & COMPLIANCE (RDS / S3)             |
|   Managed Append-Only Database (PostgreSQL / SQLite with SHA-256 Ledger)     |
|   Amazon S3 (Raw Telemetry Dumps & Model Checkpoints)                         |
|   AWS KMS (Envelope Encryption for PHI Data-at-Rest)                          |
+-------------------------------------------------------------------------------+
```

---

## 3. Key Technical Innovations Implemented

### 1. Predefined Clinical Schema (Matching Paper Table 3)
The system captures and extracts clinical parameters matching the IEEE paper:
* **Required / Critical Fields**: `lesion` (injury), `edad` (age), `actividad` (activity level).
* **Emotional / Contextual Fields**: `estado_animo`, `confianza_hablando`, `frase_motivadora`.

### 2. Decoupling Probabilistic AI from Deterministic Rules
* If the LLM experiences memory contention or hallucination, it **never** alters the medical exercise regimen directly.
* Instead, our **Deterministic Rule Engine** computes the clinical recovery score using biomechanical formulas:
  $$\text{Composite Score} = (0.35 \times \text{ROM}) + (0.35 \times \text{Completion}) + (0.20 \times \text{Reaction}) - (0.10 \times \text{Pain})$$
* This maps deterministically into:
  * **Level 1 (Score < 40 or Pain $\ge$ 7)**: Gentle Mobilization & Rest.
  * **Level 2 (Score 40–74)**: Active Recovery & Resistance Band Flexion.
  * **Level 3 (Score $\ge$ 75)**: Full Functional Conditioning & Dynamic Plyometrics.

### 3. Verification of Paper's Core Findings (GPU Offloading & CFNR)
Our telemetry simulator enables the faculty or evaluator to toggle offload configurations:
* **GPU Layers = 0 (CPU-Only)**: Mean Latency ~10.8s, CFNR = 0% (Fully stable).
* **GPU Layers = 20 (Intermediate)**: Mean Latency ~11.3s (Slower due to PCIe bus contention), CFNR = 0%.
* **GPU Layers = 30 (Aggressive)**: Lowest Latency (~8.5s), but **100% Critical-Field Null Rate (CFNR = 1.0)**! The system issues a clinical safety alert.

### 4. Append-Only Cryptographic Audit Trail
Each session record computes an SHA-256 hash incorporating the previous record's hash (`prev_hash`), ensuring that patient records cannot be altered or falsified in retrospect.

---

## 4. How to Run the Application
1. Double-click `start_app.bat` or run:
   ```bash
   python backend/app.py
   ```
2. Open your browser and navigate to:
   ```
   http://localhost:8000
   ```
3. Test with the one-click presets (**ACL Knee Rehab**, **Rotator Cuff**, **Ankle Sprain**), toggle the GPU offloading modes, and observe the live calculation and cloud-stored records.
