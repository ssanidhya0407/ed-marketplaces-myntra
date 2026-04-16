#!/usr/bin/env bash
set -euo pipefail

# Required env vars:
# AWS_REGION, AWS_ACCOUNT_ID, ECR_REPO, ECS_CLUSTER, ECS_SERVICE

: "${AWS_REGION:?AWS_REGION is required}"
: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"
: "${ECR_REPO:?ECR_REPO is required}"
: "${ECS_CLUSTER:?ECS_CLUSTER is required}"
: "${ECS_SERVICE:?ECS_SERVICE is required}"

IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"
IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"

echo "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "Building image..."
docker build -t "$IMAGE_URI" .

echo "Pushing image..."
docker push "$IMAGE_URI"

echo "Rendering task definition..."
TMP_TASK_DEF="/tmp/myntra-task-def-${IMAGE_TAG}.json"
python3 - "$IMAGE_URI" "$AWS_REGION" <<'PY' > "$TMP_TASK_DEF"
import json, sys
image_uri = sys.argv[1]
region = sys.argv[2]
with open('deploy/ecs/task-definition.json') as f:
    td = json.load(f)
td['containerDefinitions'][0]['image'] = image_uri
log_opts = td['containerDefinitions'][0]['logConfiguration']['options']
log_opts['awslogs-region'] = region
print(json.dumps(td))
PY

echo "Registering new task definition..."
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "file://${TMP_TASK_DEF}" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

echo "Updating ECS service..."
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --task-definition "$TASK_DEF_ARN" \
  --force-new-deployment >/dev/null

echo "Waiting for service stability..."
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE"

echo "Deployment complete: $TASK_DEF_ARN"
