#!/usr/bin/env bash
set -euo pipefail

# Ubuntu bootstrap for EC2 host
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release

if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable docker
  sudo systemctl start docker
fi

sudo mkdir -p /opt/myntra-oms
sudo mkdir -p /var/lib/myntra-oms/data
sudo cp deploy/ec2/run-container.sh /opt/myntra-oms/run-container.sh
sudo chmod +x /opt/myntra-oms/run-container.sh

sudo cp deploy/ec2/myntra-oms-backend.service /etc/systemd/system/myntra-oms-backend.service
sudo systemctl daemon-reload

echo "Create /etc/myntra-oms-backend.env with at least MYNTRA_WEBHOOK_TOKEN before starting service."
