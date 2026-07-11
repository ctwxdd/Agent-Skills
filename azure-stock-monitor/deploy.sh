#!/usr/bin/env bash
set -euo pipefail

: "${AZURE_RESOURCE_GROUP:=marukyu-stock-rg}"
: "${AZURE_LOCATION:=japaneast}"
: "${AZURE_CONTAINER_ENV:=marukyu-stock-env}"
: "${AZURE_JOB_NAME:=marukyu-stock-job}"
: "${AZURE_ACR_NAME:?Set AZURE_ACR_NAME to a globally unique registry name, e.g. marukyustock12345}"
: "${EMAIL_TO:=nickwu9146@gmail.com}"

IMAGE="$AZURE_ACR_NAME.azurecr.io/marukyu-stock-monitor:latest"

az group create \
  --name "$AZURE_RESOURCE_GROUP" \
  --location "$AZURE_LOCATION"

az acr create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_ACR_NAME" \
  --sku Basic \
  --admin-enabled true

ACR_PASSWORD="$(az acr credential show --name "$AZURE_ACR_NAME" --query 'passwords[0].value' -o tsv)"

az acr build \
  --registry "$AZURE_ACR_NAME" \
  --image marukyu-stock-monitor:latest \
  .

az containerapp env create \
  --name "$AZURE_CONTAINER_ENV" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --location "$AZURE_LOCATION" \
  >/dev/null

az containerapp job delete \
  --name "$AZURE_JOB_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --yes \
  >/dev/null 2>&1 || true

JOB_ARGS=(
  --name "$AZURE_JOB_NAME"
  --resource-group "$AZURE_RESOURCE_GROUP"
  --environment "$AZURE_CONTAINER_ENV"
  --trigger-type Schedule
  --cron-expression "0 * * * *"
  --replica-timeout 600
  --replica-retry-limit 1
  --replica-completion-count 1
  --parallelism 1
  --image "$IMAGE"
  --registry-server "$AZURE_ACR_NAME.azurecr.io"
  --registry-username "$AZURE_ACR_NAME"
  --registry-password "$ACR_PASSWORD"
  --cpu 1
  --memory 2Gi
  --secrets
    email-to="$EMAIL_TO"
)

ENV_VARS=(
  EMAIL_TO=secretref:email-to
)

if [[ -n "${ACS_CONNECTION_STRING:-}" && -n "${ACS_SENDER:-}" ]]; then
  JOB_ARGS+=(
    --secrets
      acs-conn="$ACS_CONNECTION_STRING"
      acs-sender="$ACS_SENDER"
  )
  ENV_VARS+=(
    ACS_CONNECTION_STRING=secretref:acs-conn
    ACS_SENDER=secretref:acs-sender
  )
fi

JOB_ARGS+=(--env-vars "${ENV_VARS[@]}")

az containerapp job create "${JOB_ARGS[@]}"

echo "Created $AZURE_JOB_NAME in $AZURE_RESOURCE_GROUP. It runs hourly and skips outside 08:00-20:00 JST."
