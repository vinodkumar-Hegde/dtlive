# DocTutorials Live Medical Classroom

A role-based live-learning workspace for medical education.

## Current capabilities

- Faculty pre-session setup for Course, Subject, Topic, schedule and outcomes
- Faculty-only camera, microphone and screen sharing
- Student watch-only live classroom
- Class chat
- Workbook and resource links
- FastAPI backend
- React/Vite frontend
- PostgreSQL, Redis and self-hosted LiveKit
- Docker Compose local development

## Roles

### Faculty

- Configure the live class
- Start and end the session
- Publish camera and microphone
- Share the screen
- Manage class details and workbooks

### Student

- Watch Faculty video and screen sharing
- Hear Faculty audio
- Participate in class chat
- View Course, Subject, Topic and workbooks
- Cannot publish camera, microphone or screen sharing

## Local development

```bash
docker compose up -d --build
```

Frontend:

```text
http://localhost:5192
```

Backend health:

```text
http://localhost:8092/health
```

## Environment

Copy the example file and provide local values:

```bash
cp .env.example .env
```

Never commit `.env`, private keys or production credentials.

## Production

Production deployment requires:

- A public application domain using HTTPS
- A public LiveKit domain using WSS
- Valid TLS certificates
- Public WebRTC TCP/UDP ports
- Production LiveKit credentials
- Restricted SSH access
- Persistent PostgreSQL storage or managed RDS
- Backups and monitoring
