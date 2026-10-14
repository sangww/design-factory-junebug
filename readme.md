## Node Package Manager

NVM is highly recommended for managing multiple versions of Node.

### Mac instruction

First, we need to install Homebrew:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install nvm
```

If you have any trouble with Homebrew setup please check: https://mac.install.guide/homebrew/

Once NVM is installed, we need to create a .nvm folder on your computer:

```bash
mkdir .nvm
```

After installation, the console process will print out information about some lines to add to one of these files:  ~/.bashrc, ~/.zshrc, or ~/.bash_profile.

You can check these files by using below command:

```bash
ls -la ~/.*
```

If none of these files exist, feel free to create ~/.zshrc (or others depending Mac OS version). In order to create or edit the file:

```bash
vim ~/.zshrc
```

In the file add the lines the installation process gave to you. If you never used vim, 'i' is the command for entering typing mode (in which you can also copy paste the lines), in order to save + quit, use 'esc' to exit typing mode and use ':wq' command and hit enter.

### Windows instruction

Download the setup version of NVM from: https://github.com/coreybutler/nvm-windows

Run the installer to install NVM.

### Linux instruction

We don't have step by step instruction here, but should be fairly straightforward. Please consult instructor if needed.

### After NVM installation, Install Node

NVM we just installed is a software to manage different Node versions easily. We now need to install a Node version that will be necessary for nodejs, react, or nextjs projects for web.

First check if NVM is properly installed in terminal.

```bash
nvm --version
```

If you confirmed installation, you can install a Node version by using below commands.

```bash
nvm install 20.19.4
nvm use 20.19.4
```

'nvm use' is the command to set the default Node version to the one installed. You can check if it is set up correctly by

```bash
nvm current
```

## Running the server

### First-time HTTPS setup

Install [mkcert](https://github.com/FiloSottile/mkcert#installation) once on the computer that will run the server.

On macOS with Homebrew:

```bash
brew install mkcert
```

On Windows with Chocolatey already installed:

```powershell
choco install mkcert
```

For other installation options, including Linux and Windows without Chocolatey, use the mkcert installation link above. Make sure `mkcert` is available in your terminal before continuing.

From the project folder, run:

```bash
npm install
npm run generate-cert
npm start
```

Accept any operating system prompt to install and trust the local development certificate authority. The script creates `server-cert.pem` and `server-key.pem` for localhost and the computer's current LAN IPv4 addresses.

Open **https://localhost:3001** in Chrome or Edge. Keep the terminal running while using the demo; only `npm start` needs to remain running. Stop the server with Ctrl+C.

### Later sessions

The home page (`/`) is the nRF BLE wearable dashboard. Use `/joycon` for Joy-Con pairing, rumble, and button/keyboard controls; those controls also work without a Joy-Con. Both pages share the same session. For a named room, use `/r/<room-name>` and `/r/<room-name>/joycon`.

Older `/nrf` links redirect to the home page, and `/gui` or `/test` links redirect to `/joycon`. Named-room links preserve their room.

```bash
npm start
```

You do not need to generate certificates every time. To replace existing certificates after a LAN IP change or certificate expiration, stop the server and run:

```bash
npm run generate-cert -- --force
npm start
```

### Localhost without certificates

For a demo entirely on the server computer, **http://localhost:3000** also supports BLE and WebHID in supported browsers such as Chrome or Edge. No certificate setup is needed for this localhost URL.

### Connecting from another computer on the LAN

Open **Join from another computer (LAN IP)** on either dashboard to see the host PC's network adapter addresses and demo links. Choose the Wi-Fi or Ethernet adapter used by the class, click the link field to select it, and copy it. Links preserve the current room and page. Refresh after changing networks; VPN or virtual adapters may also be listed.

Set `HOST=0.0.0.0` in `.env` to allow LAN connections (`HOST=127.0.0.1` restricts access to the server computer). The server prints available URLs when it starts. The default HTTP and HTTPS ports are 3000 and 3001; these can be changed with `PORT` and `HTTPS_PORT` in `.env`.

For BLE or WebHID on another computer, open **https://<server-LAN-IP>:3001**. HTTP at a LAN IP does not provide the secure context required by those APIs. Both computers must be on a network that allows connections between them; allow the demo ports through the host's private-network firewall if necessary.

Each connecting computer must also trust the server's certificate authority:

1. On the server computer, run `mkcert -CAROOT` to find the CA folder.
2. Copy only the public `rootCA.pem` to the connecting computer and install it in that computer's trusted root certificate store. See [mkcert's cross-computer trust instructions](https://github.com/FiloSottile/mkcert#installing-the-ca-on-other-systems).
3. Restart the browser and open the HTTPS LAN URL. The IP must be included in the server certificate.

Never share `server-key.pem` or `rootCA-key.pem`. Generated server certificates and private keys are excluded from Git by `.gitignore`. Installing mkcert separately on another computer does not automatically make it trust this server's CA.

