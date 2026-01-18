# Azure Cloud Functions Setup for UIUC Scheduler

This guide explains how to set up Azure Cloud Functions for real-time course availability checking.

## What This Provides

The Azure Function fetches live course availability status from UIUC Course Explorer:
- **Open/Closed/Restricted** status for each course section
- **5-minute caching** to reduce load on UIUC servers
- **Free tier eligible** - First 1M requests/month free

**Note:** UIUC Course Explorer does NOT provide numeric seat counts (enrolled/capacity). Only availability status is available.

## Prerequisites

1. **Azure Account** - Sign up at https://azure.microsoft.com/free/students/ (free tier available)
2. **Azure CLI** - Install from https://docs.microsoft.com/cli/azure/install-azure-cli
3. **Node.js 24+** and npm installed locally

## Step 1: Create Azure Resources

Open your terminal and run these commands:

```bash
# Login to Azure
az login

# Create resource group
az group create --name uiuc-scheduler-rg --location eastus

# Create storage account (required for Azure Functions)
az storage account create \
  --name uiucschedsa \
  --location eastus \
  --resource-group uiuc-scheduler-rg \
  --sku Standard_LRS

# Create Azure Function App (Node.js 24)
az functionapp create \
  --resource-group uiuc-scheduler-rg \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 24 \
  --functions-version 4 \
  --name uiuc-scheduler-functions \
  --storage-account uiucschedsa
```

## Step 2: Configure CORS

Allow your GitHub Pages site to call the Azure Function:

```bash
az functionapp cors add \
  --name uiuc-scheduler-functions \
  --resource-group uiuc-scheduler-rg \
  --allowed-origins https://lightningboltz21.github.io
```

If you also want to test locally, add localhost:

```bash
az functionapp cors add \
  --name uiuc-scheduler-functions \
  --resource-group uiuc-scheduler-rg \
  --allowed-origins http://localhost:3000
```

## Step 3: Get Publish Profile for GitHub Actions

```bash
# Download publish profile
az functionapp deployment list-publishing-profiles \
  --name uiuc-scheduler-functions \
  --resource-group uiuc-scheduler-rg \
  --xml > publish-profile.xml

# Display the content
cat publish-profile.xml
```

Copy the entire XML content from this file.

## Step 4: Add GitHub Secret

1. Go to your GitHub repository: https://github.com/lightningboltz21/uiuc-scheduler
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`
5. Value: Paste the XML content from `publish-profile.xml`
6. Click **Add secret**

## Step 5: Deploy

The Azure Function will automatically deploy when you push changes to the `apps/backend/` directory on the `main` branch.

To deploy manually:

1. Go to **Actions** tab in your GitHub repo
2. Select **Deploy Azure Function** workflow
3. Click **Run workflow** → **Run workflow**

## Testing

### Test Locally

```bash
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Navigate to backend
cd apps/backend

# Install dependencies
npm install

# Build
npm run build

# Start function locally
func start

# Test in another terminal
curl "http://localhost:7071/api/classSection?term=202602&subject=CS&courseNumber=225&crn=30107"
```

Expected response:
```json
{
  "crn": "30107",
  "availability": "Open",
  "status": "open",
  "restrictions": "",
  "lastUpdated": "2026-01-17T..."
}
```

### Test Production

After deployment completes:

```bash
curl "https://uiuc-scheduler-functions.azurewebsites.net/api/classSection?term=202602&subject=CS&courseNumber=225&crn=30107"
```

### Test Frontend Integration

```bash
cd apps/website
npm start

# Open http://localhost:3000
# Hover over a course section
# You should see availability status (Open/Closed/Restricted)
```

## Monitoring

View function logs and metrics:

```bash
# Stream live logs
az webapp log tail \
  --name uiuc-scheduler-functions \
  --resource-group uiuc-scheduler-rg

# View metrics in Azure Portal
az functionapp show \
  --name uiuc-scheduler-functions \
  --resource-group uiuc-scheduler-rg \
  --query "defaultHostName" -o tsv
```

Then open: https://portal.azure.com and navigate to your function app.

## Cost Considerations

**Azure Functions Consumption Plan:**
- ✅ **Free Tier**: 1,000,000 requests/month free
- ✅ **Expected Usage**: ~5,000 requests/day = 150,000/month
- ✅ **Well Within Free Tier**: You should not incur any charges
- ⚡ **5-minute caching**: Reduces actual requests significantly

## Troubleshooting

### Function not responding

Check if the function is running:
```bash
az functionapp show \
  --name uiuc-scheduler-functions \
  --resource-group uiuc-scheduler-rg \
  --query "state"
```

### CORS errors in browser

Ensure your domain is added to CORS:
```bash
az functionapp cors show \
  --name uiuc-scheduler-functions \
  --resource-group uiuc-scheduler-rg
```

### Deployment failed

Check deployment logs in GitHub Actions:
- Go to **Actions** tab
- Click on the failed workflow run
- Review the logs for error messages

## Cleanup (Optional)

To delete all Azure resources and stop any charges:

```bash
az group delete --name uiuc-scheduler-rg --yes
```

**Warning:** This will permanently delete all resources in the resource group.

## Alternative: Firebase Functions

If Azure setup is too complex, you could also use Firebase Functions which is already configured in this project. However, Azure was chosen for the free student credits.

## Support

For issues or questions:
- Create an issue at: https://github.com/lightningboltz21/uiuc-scheduler/issues
- Check Azure documentation: https://docs.microsoft.com/azure/azure-functions/
