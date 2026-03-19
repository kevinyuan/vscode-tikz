# Publishing to VS Code Marketplace

## Prerequisites

1. **Create a Publisher Account**
   - Go to https://marketplace.visualstudio.com/manage
   - Sign in with your Microsoft account
   - Click "Create publisher"
   - Publisher ID: `kevinyuan` (must match `package.json`)

2. **Create a Personal Access Token (PAT)**
   - Go to https://dev.azure.com
   - Click on your profile → Security → Personal Access Tokens
   - Click "New Token"
   - Name: "VS Code Extension Publishing"
   - Organization: All accessible organizations
   - Scopes: **Marketplace** → **Manage** (check this box)
   - Click "Create"
   - **IMPORTANT**: Copy the token immediately (you won't see it again)

## Publishing Steps

### First Time Setup

```bash
# Login with your PAT
npx vsce login kevinyuan
# Paste your PAT when prompted
```

### Publish the Extension

```bash
# Publish to marketplace
npx vsce publish
```

This will:
- Compile the TypeScript
- Package the extension
- Upload to the VS Code Marketplace
- Make it available for installation within minutes

### Manual Upload (Alternative)

If you prefer to upload manually:

1. Package the extension:
   ```bash
   npx vsce package
   ```

2. Go to https://marketplace.visualstudio.com/manage/publishers/kevinyuan

3. Click "New extension" → "Visual Studio Code"

4. Upload `vscode-tikzjax-0.2.0.vsix`

## Version Updates

To publish a new version:

```bash
# Bump version (patch: 0.2.0 → 0.2.1)
npx vsce publish patch

# Or bump minor version (0.2.0 → 0.3.0)
npx vsce publish minor

# Or bump major version (0.2.0 → 1.0.0)
npx vsce publish major

# Or specify exact version
npx vsce publish 0.3.0
```

## Verification

After publishing:

1. Wait 5-10 minutes for the extension to appear
2. Search for "TikZJax" in VS Code Extensions
3. Verify the publisher shows as "kevinyuan"
4. Install and test

## Marketplace Page

Your extension will be available at:
https://marketplace.visualstudio.com/items?itemName=kevinyuan.vscode-tikzjax

## Troubleshooting

### "Publisher 'kevinyuan' not found"
- Create the publisher account first at https://marketplace.visualstudio.com/manage

### "Authentication failed"
- Regenerate your PAT with correct Marketplace permissions
- Run `npx vsce login kevinyuan` again

### "Extension validation failed"
- Check that `package.json` has valid repository URL
- Ensure all required fields are present
- Run `npx vsce package` to test locally first

## Current Status

- ✅ Package built: `vscode-tikzjax-0.2.0.vsix`
- ✅ Repository pushed: https://github.com/kevinyuan/vscode-tikz
- ✅ Publisher ID updated: `kevinyuan`
- ⏳ Marketplace publishing: **Ready to publish**

Run `npx vsce publish` when ready!
