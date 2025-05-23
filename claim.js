const axios = require('axios');
const fs = require('fs');
const { sendReport } = require('./telegramReporter');
const path = require('path');
const moment = require('moment');
const readline = require('readline');
const { clear } = require('console');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require('https');

const API_BASE_URL = 'https://prod.interlinklabs.ai/api/v1';
const TOKEN_FILE_PATH = path.join(__dirname, 'token.txt');
const PROXIES_FILE_PATH = path.join(__dirname, 'proxies.txt');

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const logger = {
  info: (msg) => console.log(`${colors.green}[âœ“] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[âš ] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[âœ—] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[âœ…] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[âŸ³] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[âž¤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`Interlink   Auto Bot - Airdrop Insiders`);
    console.log(`---------------------------------------------${colors.reset}`);
    console.log();
  }
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function promptInput(question) {
  return new Promise((resolve) => {
    rl.question(`${colors.white}${question}${colors.reset}`, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function sendOtp(apiClient, loginId, passcode, email) {
  try {
    const payload = { loginId, passcode, email };
    const response = await apiClient.post('/auth/send-otp-email-verify-login', payload);
    if (response.data.statusCode === 200) {
      logger.success(response.data.message);
      logger.info(`If OTP doesn't arrive, stop the bot (Ctrl+C) and restart.`);
    } else {
      logger.error(`Failed to send OTP: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    logger.error(`Error sending OTP: ${error.response?.data?.message || error.message}`);
    if (error.response?.data) {
      logger.error(`Response details: ${JSON.stringify(error.response.data)}`);
    }
  }
}

async function verifyOtp(apiClient, loginId, otp) {
  try {
    const payload = { loginId, otp };
    const response = await apiClient.post('/auth/check-otp-email-verify-login', payload);
    if (response.data.statusCode === 200) {
      logger.success(response.data.message);
      const token = response.data.data.jwtToken;
      saveToken(token);
      return token;
    } else {
      logger.error(`Failed to verify OTP: ${JSON.stringify(response.data)}`);
      return null;
    }
  } catch (error) {
    logger.error(`Error verifying OTP: ${error.response?.data?.message || error.message}`);
    if (error.response?.data) {
      logger.error(`Response details: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

function saveToken(token) {
  try {
    fs.writeFileSync(TOKEN_FILE_PATH, token);
    logger.info(`Token saved to ${TOKEN_FILE_PATH}`);
  } catch (error) {
    logger.error(`Error saving token: ${error.message}`);
  }
}

async function login(proxies) {
  const loginId = await promptInput('Enter your login ID (or email): ');
  const passcode = await promptInput('Enter your passcode: ');
  const email = await promptInput('Enter your email: ');

  let apiClient;
  const proxy = getRandomProxy(proxies);

  if (proxy) {
    logger.step(`Attempting to send OTP with proxy: ${proxy}`);
    apiClient = createApiClient(null, proxy);
  } else {
    logger.step(`Attempting to send OTP without proxy...`);
    apiClient = createApiClient(null);
  }

  await sendOtp(apiClient, loginId, passcode, email);
  const otp = await promptInput('Enter OTP: ');
  const token = await verifyOtp(apiClient, loginId, otp);

  return token;
}

function readToken() {
  try {
    return fs.readFileSync(TOKEN_FILE_PATH, 'utf8').trim();
  } catch (error) {
    logger.warn(`Token file not found or invalid. Will attempt login.`);
    return null;
  }
}

function readProxies() {
  try {
    if (!fs.existsSync(PROXIES_FILE_PATH)) {
      logger.warn(`Proxies file not found. Running without proxies.`);
      return [];
    }
    
    const content = fs.readFileSync(PROXIES_FILE_PATH, 'utf8');
    return content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (error) {
    logger.error(`Error reading proxies file: ${error.message}`);
    return [];
  }
}

function getRandomProxy(proxies) {
  if (!proxies.length) return null;
  return proxies[Math.floor(Math.random() * proxies.length)];
}

function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;

  if (proxyUrl.startsWith('socks://') || proxyUrl.startsWith('socks4://') || proxyUrl.startsWith('socks5://')) {
    return new SocksProxyAgent(proxyUrl);
  } else {
    return new HttpsProxyAgent(proxyUrl);
  }
}

function createApiClient(token, proxy = null) {
  const config = {
    baseURL: API_BASE_URL,
    headers: {
      'User-Agent': 'okhttp/4.12.0',
      'Accept-Encoding': 'gzip'
    },
    timeout: 30000,
    httpsAgent: new https.Agent({ 
      rejectUnauthorized: false
    })
  };
  
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (proxy) {
    try {
      const proxyAgent = createProxyAgent(proxy);
      config.httpsAgent = proxyAgent;
      config.proxy = false;
      logger.info(`Using proxy: ${proxy}`);
    } catch (error) {
      logger.error(`Error setting up proxy: ${error.message}`);
    }
  }
  
  return axios.create(config);
}

function formatTimeRemaining(milliseconds) {
  if (milliseconds <= 0) return '00:00:00';
  
  const seconds = Math.floor((milliseconds / 1000) % 60);
  const minutes = Math.floor((milliseconds / (1000 * 60)) % 60);
  const hours = Math.floor((milliseconds / (1000 * 60 * 60)) % 24);
  
  return [hours, minutes, seconds]
    .map(val => val.toString().padStart(2, '0'))
    .join(':');
}

async function getCurrentUser(apiClient) {
  try {
    const response = await apiClient.get('/auth/current-user');
    return response.data.data;
  } catch (error) {
    logger.error(`Error getting user information: ${error.response?.data?.message || error.message}`);
    return null;
  }
}

async function getTokenBalance(apiClient) {
  try {
    const response = await apiClient.get('/token/get-token');
    return response.data.data;
  } catch (error) {
    logger.error(`Error getting token balance: ${error.response?.data?.message || error.message}`);
    return null;
  }
}

async function checkIsClaimable(apiClient) {
  try {
    const response = await apiClient.get('/token/check-is-claimable');
    return response.data.data;
  } catch (error) {
    logger.error(`Error checking if airdrop is claimable: ${error.response?.data?.message || error.message}`);
    return { isClaimable: false, nextFrame: Date.now() + 1000 * 60 * 5 };
  }
}

async function claimAirdrop(apiClient) {
  try {
    await apiClient.post('/token/claim-airdrop');
    logger.success(`Airdrop claimed successfully!`);
    return { success: true, nextFrame: null };
  } catch (e) {
    const errData = e.response?.data;
    if (errData?.code === 'TOKEN_CLAIM_TOO_EARLY' && errData.data?.nextFrame) {
      const nf = errData.data.nextFrame;
      logger.warn(`Too early to claim. Next allowed at ${moment(nf).format('YYYY-MM-DD HH:mm:ss')}`);
      return { success: false, nextFrame: nf };
    }
    logger.error(`Error claiming airdrop: ${errData?.message || e.message}`);
    return { success: false, nextFrame: null };
  }
}

function displayUserInfo(userInfo, tokenInfo) {
  if (!userInfo || !tokenInfo) return;
  
  console.log('\n' + '='.repeat(50));
  console.log(`${colors.yellow}${colors.bold}ðŸ‘¤ USER INFORMATION${colors.reset}`);
  console.log(`${colors.yellow}Username:${colors.reset} ${userInfo.username}`);
  console.log(`${colors.yellow}Email:${colors.reset} ${userInfo.email}`);
  console.log(`${colors.yellow}Wallet:${colors.reset} ${userInfo.connectedAccounts?.wallet?.address || 'Not connected'}`);
  console.log(`${colors.yellow}User ID:${colors.reset} ${userInfo.loginId}`);
  console.log(`${colors.yellow}Referral ID:${colors.reset} ${tokenInfo.userReferralId}`);
  
  console.log('\n' + '='.repeat(50));
  console.log(`${colors.yellow}${colors.bold}ðŸ’° TOKEN BALANCE${colors.reset}`);
  console.log(`${colors.yellow}Gold Tokens:${colors.reset} ${tokenInfo.interlinkGoldTokenAmount}`);
  console.log(`${colors.yellow}Silver Tokens:${colors.reset} ${tokenInfo.interlinkSilverTokenAmount}`);
  console.log(`${colors.yellow}Diamond Tokens:${colors.reset} ${tokenInfo.interlinkDiamondTokenAmount}`);
  console.log(`${colors.yellow}Interlink Tokens:${colors.reset} ${tokenInfo.interlinkTokenAmount}`);
  console.log(`${colors.yellow}Last Claim:${colors.reset} ${moment(tokenInfo.lastClaimTime).format('YYYY-MM-DD HH:mm:ss')}`);
  console.log('='.repeat(50) + '\n');
}

async function tryConnect(token, proxies) {
  let apiClient;
  let userInfo = null;
  let tokenInfo = null;
  
  logger.step(`Attempting connection without proxy...`);
  apiClient = createApiClient(token);
  
  logger.loading(`Retrieving user information...`);
  userInfo = await getCurrentUser(apiClient);
  
  if (!userInfo && proxies.length > 0) {
    let attempts = 0;
    const maxAttempts = Math.min(proxies.length, 5);
    
    while (!userInfo && attempts < maxAttempts) {
      const proxy = proxies[attempts];
      logger.step(`Trying with proxy ${attempts + 1}/${maxAttempts}: ${proxy}`);
      
      apiClient = createApiClient(token, proxy);
      
      logger.loading(`Retrieving user information...`);
      userInfo = await getCurrentUser(apiClient);
      attempts++;
      
      if (!userInfo) {
        logger.warn(`Proxy ${proxy} failed. Trying next...`);
      }
    }
  }
  
  if (userInfo) {
    logger.loading(`Retrieving token balance...`);
    tokenInfo = await getTokenBalance(apiClient);
  }
  
  return { apiClient, userInfo, tokenInfo };
}
    
async function runBot() {
  clear();
  logger.banner();

  // Baca file proxies jika ada
  const proxies = readProxies();

  // Baca token atau lakukan login
  let token = readToken();
  if (!token) {
    token = await login(proxies);
    if (!token) process.exit(1);
  }

  // Siapkan API client dengan token
  const apiClient = createApiClient(token);

  // Tampilkan informasi user & token (opsional)
  const userInfo = await getCurrentUser(apiClient);
  const tokenInfo = await getTokenBalance(apiClient);
  displayUserInfo(userInfo, tokenInfo);

  // ===== LOOP UTAMA UNTUK CLAIM OTOMATIS =====
  const CLAIM_INTERVAL_MS = 4 * 60 * 60 * 1000; // fallback 4 jam

  // Ambil jadwal klaim pertama kali dari API
  const { nextFrame: initialFrame } = await checkIsClaimable(apiClient);
  let nextClaimTime = initialFrame;
  logger.info(`Next claim slot: ${moment(nextClaimTime).format('YYYY-MM-DD HH:mm:ss')}`);

  // Loop per detik: cek apakah sudah waktunya klaim
  setInterval(async () => {
    const now = Date.now();

    if (now >= nextClaimTime) {
      logger.step(`Attempting claim at ${moment(now).format('HH:mm:ss')}`);
      try {
        const { success, nextFrame } = await claimAirdrop(apiClient);
        // Jika sukses: jadwalkan +4 jam; jika terlalu awal: pakai nextFrame
        nextClaimTime = success
          ? now + CLAIM_INTERVAL_MS
          : (nextFrame || (now + CLAIM_INTERVAL_MS));
        logger.info(`Next claim scheduled at ${moment(nextClaimTime).format('YYYY-MM-DD HH:mm:ss')}`);
        if (success) {
          const updatedUserInfo = await getCurrentUser(apiClient);
          const updatedTokenInfo = await getTokenBalance(apiClient);
          const {
            interlinkGoldTokenAmount = 0,
            interlinkSilverTokenAmount = 0,
            interlinkDiamondTokenAmount = 0,
            interlinkTokenAmount: totalBalance = 0,
            lastClaimTime
          } = updatedTokenInfo;

          const msgLines = [
            '✅ *Airdrop Claimed!*',
            '',
            `👤 *${updatedUserInfo.username}*`,
            `💰 *Total Balance:* ${totalBalance}`,
            `   • Gold: ${interlinkGoldTokenAmount}`,
            `   • Silver: ${interlinkSilverTokenAmount}`,
            `   • Diamond: ${interlinkDiamondTokenAmount}`,
            `🕒 *Last Claim:* ${moment(lastClaimTime).format('YYYY-MM-DD HH:mm:ss')}`
            ];
          sendReport(msgLines.join('\n'));
        }
      } catch (err) {
        logger.error(`Unexpected error during claim: ${err.message}`);
        // Opsi: atur ulang nextClaimTime di sini atau exit
      }
    } else {
      const diff = nextClaimTime - now;
      process.stdout.write(`\rNext claim in ${moment(diff).utc().format('HH:mm:ss')}   `);
    }
  }, 1000);

  logger.success(`Bot is running! Airdrop claims will be attempted automatically.`);
  logger.info(`Press Ctrl+C to exit`);
}

runBot().finally(() => rl.close());
