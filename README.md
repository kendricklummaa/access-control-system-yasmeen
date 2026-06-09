# Web-Based Facial Recognition & Liveness Detection Access Control System

**HND Computer Science Final Year Project**
Federal Polytechnic Nasarawa — Computer Science Department

---

## Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Frontend    | HTML5, CSS3, JavaScript (ES6)     |
| Face AI     | face-api.js (in-browser)          |
| Backend     | Node.js + Express.js              |
| Database    | SQLite via Python (db_manager.py) |
| CV/Liveness | Python 3 + OpenCV + DeepFace      |

---

## Quick Start

### Requirements
- Node.js v18+
- Python 3.10+
- `opencv-python-headless` and `deepface` Python packages

### Install & Run

```bash
# Install Node dependencies
npm install

# Start the server
npm start
```

Open your browser at: **http://localhost:3000**

---

## Project Structure

```
access-control/
├── backend/
│   ├── server.js              ← Express entry point
│   ├── db.js                  ← Node → Python DB bridge
│   ├── routes/
│   │   ├── enroll.js          ← POST /api/enroll
│   │   ├── auth.js            ← GET/POST /api/auth/*
│   │   └── admin.js           ← GET/DELETE /api/admin/*
│   ├── middleware/
│   │   └── errorHandler.js
│   └── python/
│       └── db_manager.py      ← All SQLite logic
├── frontend/
│   ├── index.html             ← Home / landing
│   ├── enroll.html            ← User registration
│   ├── auth.html              ← Authentication
│   ├── admin.html             ← Admin dashboard
│   ├── css/style.css
│   └── js/
│       ├── enroll.js          ← Phase 2
│       ├── auth.js            ← Phase 3 & 4
│       └── admin.js           ← Phase 5
├── database/
│   └── access_control.db      ← Auto-created on first run
└── package.json
```

---

## API Endpoints

| Method | Endpoint                  | Description                    |
|--------|---------------------------|--------------------------------|
| GET    | /api/health               | Server health check            |
| POST   | /api/enroll               | Register a new user + face     |
| GET    | /api/auth/descriptors     | Fetch all stored descriptors   |
| POST   | /api/auth/decision        | Apply A = R × L, log result    |
| POST   | /api/auth/log             | Standalone log entry           |
| GET    | /api/admin/users          | List all registered users      |
| DELETE | /api/admin/users/:id      | Delete a user                  |
| GET    | /api/admin/logs           | Access logs (filter by outcome)|
| GET    | /api/admin/stats          | Dashboard statistics           |

---

## Build Phases

- [x] **Phase 1** — Project setup, folder structure, server, database schema
- [ ] **Phase 2** — Face detection & user enrolment (face-api.js)
- [ ] **Phase 3** — Liveness detection (EAR blink check)
- [ ] **Phase 4** — Face recognition & access decision (A = R × L)
- [ ] **Phase 5** — Admin dashboard
- [ ] **Phase 6** — Integration testing
