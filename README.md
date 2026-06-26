# NEWERA — 7 Microservices + Docker + Kubernetes (Minikube) + Jenkins + Prometheus + Grafana + Email Alerts

A production-style microservices reference project: independent databases per service, full
order saga with compensation, containerization, orchestration, CI/CD, monitoring, and
email alerting to **kalirahul176@gmail.com**.

## Architecture

```
                                ┌────────────────┐
                        Client→ │  API Gateway   │  (port 8080)
                                └───────┬────────┘
        ┌──────────┬──────────┬────────┼────────┬──────────┬──────────┐
        ▼          ▼          ▼        ▼        ▼          ▼          ▼
   auth-service user-service product- order-  inventory- payment-  notification-
   (Postgres)  (Postgres)  service   service   service    service    service
                            (Mongo) (Postgres) (Postgres) (Postgres)  (Mongo)
```

**order-service** runs the real saga on `POST /orders`:
1. Validate user (user-service) + product (product-service)
2. Reserve stock (inventory-service) — atomic, fails if insufficient
3. Charge payment (payment-service) — mock gateway, ~5% random decline to simulate real failures
4. If payment fails → **release reserved stock** (compensation) + send a failure notification
5. If payment succeeds → persist order as CONFIRMED + send a success notification
6. notification-service emails **kalirahul176@gmail.com** for both outcomes (if SMTP is configured)

## The 7 microservices

| Service | Tech | Responsibility |
|---|---|---|
| auth-service | Node + Postgres + JWT + bcrypt | register / login / verify tokens |
| user-service | Node + Postgres | user profile CRUD |
| product-service | Node + MongoDB | product catalog CRUD |
| inventory-service | Node + Postgres | stock levels, reserve/release (atomic) |
| payment-service | Node + Postgres | mock payment charge + ledger |
| order-service | Node + Postgres | order orchestration / saga |
| notification-service | Node + MongoDB + Nodemailer | logs + emails alerts |

Plus **api-gateway** (Node, reverse proxy, single entry point at `/api/*`).

Every service exposes `/health` and `/metrics` (Prometheus format).

## Folder layout

```
D:\NEWERA
├── services/
│   ├── auth-service/  user-service/  product-service/
│   ├── inventory-service/  payment-service/
│   ├── order-service/  notification-service/
├── api-gateway/
├── k8s/
│   ├── 00-namespace.yaml
│   ├── databases/databases.yaml          (7 DBs: 5 Postgres + 2 Mongo)
│   ├── auth-service/  user-service/  product-service/
│   ├── inventory-service/  payment-service/
│   ├── order-service/  notification-service/  api-gateway/
│   └── monitoring/{prometheus.yaml, alertmanager.yaml, grafana.yaml}
├── monitoring/
│   ├── prometheus/{prometheus.yml, alert.rules.yml}
│   ├── alertmanager/alertmanager.yml      (email → kalirahul176@gmail.com)
│   └── grafana/dashboards/newera-overview.json
├── docker-compose.yml
├── Jenkinsfile
└── README.md
```

---

## Email alerts — IMPORTANT setup step

Alerts are sent via **Prometheus Alertmanager** to `kalirahul176@gmail.com`. Gmail will **not**
accept your normal account password for SMTP — you must generate an **App Password**:

1. Go to https://myaccount.google.com/apppasswords (requires 2-Step Verification enabled on the *sending* Gmail account — this can be a different account than the recipient, e.g. create `newera-alerts@gmail.com` or use any Gmail account you control)
2. Generate an app password for "Mail"
3. Plug it in:
   - **Docker Compose mode**: create a `.env` file in `D:\NEWERA` with:
     ```
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     SMTP_USER=your-sending-account@gmail.com
     SMTP_PASS=your-16-char-app-password
     SMTP_FROM="NEWERA Alerts" <your-sending-account@gmail.com>
     ```
     Also edit `monitoring/alertmanager/alertmanager.yml` and replace `smtp_auth_password` / `smtp_from` with the same values.
   - **Kubernetes mode**: edit `k8s/monitoring/alertmanager.yaml` (replace `REPLACE_WITH_GMAIL_APP_PASSWORD` and `smtp_from`) and `k8s/notification-service/deployment.yaml`'s `smtp-secret`.

Two alerting layers exist:
- **Alertmanager** → infra-level alerts (service down, high error rate, payment failure spikes, auth brute-force attempts, low stock, pod crash-looping) — all routed to `kalirahul176@gmail.com`.
- **notification-service** → business-level events (order confirmed/failed) — also emails the same address via `/notify`.

---

## Prerequisites (Windows)
1. Docker Desktop (WSL2 backend)
2. Minikube — https://minikube.sigs.k8s.io/docs/start/
3. kubectl
4. Place this project at **`D:\NEWERA`**

---

## Option A — Docker Compose (fastest)

```powershell
cd D:\NEWERA
docker compose build
docker compose up -d
docker compose ps
```

Endpoints (through the gateway, port 8080):
- `POST /api/auth/register` `{ "email": "...", "password": "..." }`
- `POST /api/auth/login` → returns JWT
- `GET/POST /api/users`
- `GET/POST /api/products`
- `POST /api/inventory` `{ "productId": "<id>", "available": 100 }`
- `POST /api/orders` `{ "userId":1, "productId":"<id>", "quantity":2, "amount":998 }`
- `GET /api/payments`
- `GET /api/notifications`

Monitoring:
- Prometheus: http://localhost:9090
- Alertmanager: http://localhost:9093
- Grafana: http://localhost:3000 (admin / admin123) — import `monitoring/grafana/dashboards/newera-overview.json`
- Jenkins: http://localhost:8081

---

## Option B — Full Kubernetes via Minikube

```powershell
cd D:\NEWERA
minikube start --cpus=4 --memory=8192 --driver=docker
minikube addons enable metrics-server

& minikube -p minikube docker-env --shell powershell | Invoke-Expression
docker build -t newera/auth-service:latest ./services/auth-service
docker build -t newera/user-service:latest ./services/user-service
docker build -t newera/product-service:latest ./services/product-service
docker build -t newera/inventory-service:latest ./services/inventory-service
docker build -t newera/payment-service:latest ./services/payment-service
docker build -t newera/order-service:latest ./services/order-service
docker build -t newera/notification-service:latest ./services/notification-service
docker build -t newera/api-gateway:latest ./api-gateway

kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/databases/databases.yaml
kubectl apply -f k8s/auth-service/deployment.yaml
kubectl apply -f k8s/user-service/deployment.yaml
kubectl apply -f k8s/product-service/deployment.yaml
kubectl apply -f k8s/inventory-service/deployment.yaml
kubectl apply -f k8s/payment-service/deployment.yaml
kubectl apply -f k8s/order-service/deployment.yaml
kubectl apply -f k8s/notification-service/deployment.yaml
kubectl apply -f k8s/api-gateway/deployment.yaml
kubectl apply -f k8s/monitoring/prometheus.yaml
kubectl apply -f k8s/monitoring/alertmanager.yaml
kubectl apply -f k8s/monitoring/grafana.yaml

kubectl -n newera get pods -w
```

Access:
```powershell
minikube service api-gateway -n newera --url
minikube service prometheus -n newera --url
minikube service alertmanager -n newera --url
minikube service grafana -n newera --url
```

## Jenkins
```powershell
docker compose up -d jenkins
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
docker cp $env:USERPROFILE\.kube jenkins:/var/jenkins_home/.kube
docker cp $env:USERPROFILE\.minikube jenkins:/var/jenkins_home/.minikube
docker exec -u root jenkins sh -c "chown -R jenkins:jenkins /var/jenkins_home/.kube /var/jenkins_home/.minikube"
```
Create a Pipeline job → **Pipeline script from SCM** (or paste `Jenkinsfile` directly) → Build Now.
It installs/tests all 7 services, builds 8 Docker images, loads them into Minikube, applies every manifest, and verifies rollout.

## Tear down
```powershell
docker compose down -v
kubectl delete namespace newera
minikube stop
```

## Next steps you may want
- Ingress instead of NodePorts (`minikube addons enable ingress`)
- kube-state-metrics + node-exporter for cluster-level Grafana panels
- Real Git remote + webhook for Jenkins instead of manual builds
- Helm chart to template all of `k8s/`
