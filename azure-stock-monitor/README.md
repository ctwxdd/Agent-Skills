# Marukyu Stock Monitor on Azure

Container Apps Job that checks 又玄 Yugen, 五十鈴 Isuzu, and 青嵐 Aoarashi hourly with Node `fetch`. The job runs every UTC hour, then the script skips unless the current time in Japan is 08:00-20:59.

Secrets are injected as Azure Container Apps secrets. Do not commit credentials.

Required environment variables before running `deploy.sh`:

```bash
export AZURE_ACR_NAME="<globally-unique-acr-name>"
export EMAIL_TO="nickwu9146@gmail.com"
```

Email uses Azure Communication Services Email:

```bash
export ACS_CONNECTION_STRING="<acs-connection-string>"
export ACS_SENDER="DoNotReply@your-azure-managed-domain.azurecomm.net"
```

Deploy:

```bash
cd azure-stock-monitor
./deploy.sh
```

The monitor sends email only when at least one variant is detected with `Add To Cart`.
Set `EMAIL_ALWAYS=1` for a one-off test email even when nothing is available.
