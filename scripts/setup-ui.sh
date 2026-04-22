#!/usr/bin/env bash
# ============================================================
# setup-ui.sh — Install or update netorch-ui
# Run as root: sudo bash scripts/setup-ui.sh
# ============================================================
set -euo pipefail

INSTALL_DIR="/opt/netorch-ui"
SERVICE="netorch-ui"
PYTHON="python3"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || error "Run as root: sudo bash scripts/setup-ui.sh"

# ── Python check ─────────────────────────────────────────────────────────────
$PYTHON --version &>/dev/null || error "python3 not found"
PY_VER=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
info "Python ${PY_VER} found"

# ── Detect source directory (where this script lives) ────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"

info "Installing from: ${SRC_DIR}"
info "Installing to:   ${INSTALL_DIR}"

# ── Stop service if running ───────────────────────────────────────────────────
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
    info "Stopping ${SERVICE}…"
    systemctl stop "$SERVICE"
fi

# ── Create install dir + netorch group ───────────────────────────────────────
mkdir -p "$INSTALL_DIR"
getent group netorch &>/dev/null || groupadd --system netorch
id -u netorch &>/dev/null       || useradd  --system --no-create-home --gid netorch netorch

# ── Copy files ────────────────────────────────────────────────────────────────
info "Copying application files…"
rsync -a --exclude=__pycache__ --exclude='*.pyc' --exclude='.git' \
    "${SRC_DIR}/" "${INSTALL_DIR}/"

# ── Python venv ───────────────────────────────────────────────────────────────
info "Creating Python virtual environment…"
$PYTHON -m venv "${INSTALL_DIR}/venv"
"${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${INSTALL_DIR}/requirements.txt"
info "Python dependencies installed"

# ── Config file ───────────────────────────────────────────────────────────────
if [[ ! -f "${INSTALL_DIR}/netorch-ui.toml" ]]; then
    warn "No netorch-ui.toml found — creating template"
    cp "${SRC_DIR}/netorch-ui.toml" "${INSTALL_DIR}/netorch-ui.toml"
    warn "Edit ${INSTALL_DIR}/netorch-ui.toml and set auth_token before starting"
fi

# ── Permissions ───────────────────────────────────────────────────────────────
chown -R netorch:netorch "${INSTALL_DIR}"
chmod 640 "${INSTALL_DIR}/netorch-ui.toml"   # config contains token

# ── Systemd service ───────────────────────────────────────────────────────────
info "Installing systemd service…"
cat > "/etc/systemd/system/${SERVICE}.service" << 'UNIT'
[Unit]
Description=netorch Web UI — BigFix Network Device Orchestrator
Documentation=https://github.com/raghavgrover/netorch
After=network.target netorch.service
Wants=netorch.service

[Service]
Type=simple
User=netorch
Group=netorch
WorkingDirectory=/opt/netorch-ui
Environment=NETORCH_UI_CONFIG=/opt/netorch-ui/netorch-ui.toml
ExecStart=/opt/netorch-ui/venv/bin/gunicorn \
    --worker-class gevent \
    --workers 2 \
    --bind 0.0.0.0:64322 \
    --timeout 120 \
    --keep-alive 5 \
    --access-logfile - \
    --error-logfile - \
    --log-level info \
    app:app
Restart=on-failure
RestartSec=5

# Resource limits — protect the relay server
MemoryMax=256M
CPUQuota=20%

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE"
info "Systemd service installed and enabled"

# ── Firewall ─────────────────────────────────────────────────────────────────
if command -v firewall-cmd &>/dev/null; then
    firewall-cmd --quiet --permanent --add-port=64322/tcp 2>/dev/null || true
    firewall-cmd --quiet --reload 2>/dev/null || true
    info "firewalld: opened port 64322/tcp"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
info "Installation complete."
echo ""
echo "  Next steps:"
echo "  1. Edit /opt/netorch-ui/netorch-ui.toml — set auth_token to match netorch.toml"
echo "  2. sudo systemctl start netorch-ui"
echo "  3. Open http://$(hostname -I | awk '{print $1}'):64322"
echo ""
