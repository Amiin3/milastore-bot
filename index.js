const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const express = require('express');
const mysql = require('mysql2/promise');
const qrcode = require('qrcode-terminal');
require('dotenv').config({ path: '/www/wwwroot/milastore.web.id/.env' });

const app = express();
app.use(express.json());
let sock;
const API_KEY = 'MILA_SEC_v9B4xK8mP2qL7jW5nC3zR1hT6fD0yX5g';
const userState = {};
const notifQueue = [];
let isProcessingQueue = false;

const pool = mysql.createPool({ 
    host: process.env.DB_HOST || '127.0.0.1', user: process.env.DB_USERNAME, 
    password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
    waitForConnections: true, connectionLimit: 10
});

async function processQueue() {
    if (isProcessingQueue || notifQueue.length === 0 || !sock) return;
    isProcessingQueue = true;
    while (notifQueue.length > 0) {
        const task = notifQueue.shift();
        try {
            if (task.type === 'text') await sock.sendMessage(task.jid, { text: task.msg });
            else if (task.type === 'image') await sock.sendMessage(task.jid, { image: { url: task.url }, caption: task.cap });
            else if (task.type === 'file') await sock.sendMessage(task.jid, { document: { url: task.path }, fileName: task.name, caption: task.cap, mimetype: 'application/x-gzip' });
        } catch (e) { console.error("Send Error:", e.message); }
        await new Promise(r => setTimeout(r, 1500));
    }
    isProcessingQueue = false;
}

// 🚀 POLLING DEPOSIT & ORDERAN
async function smartPolling() {
    if (!sock) return setTimeout(smartPolling, 5000);
    try {
        await pool.query("ALTER TABLE deposits ADD COLUMN wa_notif TINYINT(1) DEFAULT 0").catch(()=>{});
        const [depoRows] = await pool.query("SELECT d.*, u.whatsapp, u.phone FROM deposits d JOIN users u ON d.user_id = u.id WHERE LOWER(d.status) IN ('sukses', 'paid', 'success') AND d.wa_notif = 0");
        for (const row of depoRows) {
            let target = (row.phone || row.whatsapp).replace(/[^0-9]/g, '');
            if (target.startsWith('0')) target = '62' + target.substring(1);
            const msg = `💰 *SALDO MILASTORE MASUK!* 💰\n┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n│ 🏦 Metode: *${row.metode}*\n│ 💸 Nominal: *Rp ${parseInt(row.amount).toLocaleString('id-ID')}*\n│ ✅ Status: *BERHASIL*\n└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\nSaldo otomatis ditambahkan. Selamat bertransaksi Bosku! 🚀`;
            notifQueue.push({ type: 'text', jid: `${target}@s.whatsapp.net`, msg: msg });
            await pool.query("UPDATE deposits SET wa_notif = 1 WHERE id = ?", [row.id]);
            processQueue();
        }

        await pool.query("ALTER TABLE transaksi ADD COLUMN wa_notif TINYINT(1) DEFAULT 0").catch(()=>{});
        const [trxRows] = await pool.query("SELECT t.*, u.whatsapp, u.phone FROM transaksi t JOIN users u ON t.username = u.name WHERE LOWER(t.status) IN ('sukses', 'success', 'gagal', 'failed', 'error') AND t.wa_notif = 0");
        for (const row of trxRows) {
            let target = (row.phone || row.whatsapp).replace(/[^0-9]/g, '');
            if (target.startsWith('0')) target = '62' + target.substring(1);
            
            const isSuccess = ['sukses', 'success'].includes(row.status.toLowerCase());
            const title = isSuccess ? "📦 *ORDERAN BERHASIL!* 📦" : "❌ *ORDERAN GAGAL!* ❌";
            const statText = isSuccess ? "✅ SUKSES" : "❌ GAGAL (Saldo Refund)";
            const snText = row.sn ? row.sn : '-';
            
            const msg = `${title}\n┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n│ 🛍️ Produk: *${row.kode_layanan}*\n│ 🎯 Tujuan: *${row.tujuan}*\n│ 🧾 SN: *${snText}*\n│ 📊 Status: *${statText}*\n└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\nTerima kasih Bosku! 🚀`;
            
            notifQueue.push({ type: 'text', jid: `${target}@s.whatsapp.net`, msg: msg });
            await pool.query("UPDATE transaksi SET wa_notif = 1 WHERE id = ?", [row.id]);
            processQueue();
        }
    } catch (e) {}
    setTimeout(smartPolling, 10000);
}

// 🚀 FIX: target.toString() biar gak error kalau datanya Integer
app.post('/send-notif', (req, res) => {
    const { target, message, key } = req.body;
    if (key !== API_KEY && key !== 'SULTAN_MILA_2026') return res.sendStatus(403);
    let num = target.toString().replace(/[^0-9]/g, ''); if (num.startsWith('0')) num = '62' + num.substring(1);
    notifQueue.push({ type: 'text', jid: `${num}@s.whatsapp.net`, msg: message });
    processQueue(); res.json({ status: true });
});

app.post('/send-file', (req, res) => {
    const { target, filePath, fileName, caption, key } = req.body;
    if (key !== API_KEY) return res.sendStatus(403);
    let num = target.toString().replace(/[^0-9]/g, ''); if (num.startsWith('0')) num = '62' + num.substring(1);
    notifQueue.push({ type: 'file', jid: `${num}@s.whatsapp.net`, path: filePath, name: fileName, cap: caption });
    processQueue(); res.json({ status: true });
});

app.listen(3333, '0.0.0.0');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_milabot');
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, logger: pino({ level: 'silent' }), auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })) }, browser: Browsers.macOS('Chrome') });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => { 
        if (u.qr) qrcode.generate(u.qr, { small: true });
        if (u.connection === 'close') startBot(); 
        if (u.connection === 'open') { console.log('✅ BOT MILASTORE READY & OTP AKTIF!'); smartPolling(); }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0]; if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;
        const no_wa = (msg.key.participant || jid).split('@')[0].split(':')[0]; 
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        const args = text.split(/ +/);
        const cmd = args[0].toLowerCase();
        let apiData = { no_wa: no_wa };

        if (/^d(\d+)$/.test(cmd)) {
            const idx = cmd.replace('d', '');
            userState[no_wa] = { step: 'wait_nom', method: idx };
            let bank = (idx=='1')?'JAGO':(idx=='2')?'SEABANK':(idx=='3')?'GOPAY':'SHOPEE';
            return sock.sendMessage(jid, { text: `┌──[ 💳 *DEPOSIT ${bank}* ]──\n\nBerapa nominal isi saldonya?\n👉 Contoh: *10k* atau *50000*\n\n└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈` });
        }

        if (userState[no_wa]?.step === 'wait_nom' && /^\d+k?$/.test(text.toLowerCase())) {
            apiData.command = 'deposit_create';
            apiData.metode = userState[no_wa].method;
            apiData.nominal = text.toLowerCase();
            delete userState[no_wa];
        } 
        else if (cmd === 'p' || cmd === 'menu') apiData.command = 'main_menu';
        else if (cmd === '1') apiData.command = 'menu_xla';
        else if (cmd === '2') apiData.command = 'menu_xda';
        else if (cmd === '3') apiData.command = 'menu_pln';
        else if (cmd === '4') apiData.command = 'menu_data';
        else if (cmd === '5') apiData.command = 'menu_aktif';
        else if (cmd === '.login') { apiData.command = 'login'; apiData.target_number = args[1]; }
        else if (cmd === '.order') { apiData.command = 'order_akrab'; apiData.kode = args[1]; apiData.target = args[2]; }
        else if (cmd === '.sikat') { apiData.command = 'war_sikat'; apiData.kode = args[1]; apiData.target = args[2]; }
        else if (cmd === '.depo' || cmd === 'depo') { apiData.command = 'deposit_create'; apiData.nominal = args[1] || ''; apiData.metode = args[2] || ''; }
        else if (cmd === '.batal' || cmd === 'batal') apiData.command = 'deposit_cancel';
        else if (/^\d{6}$/.test(text)) { apiData.command = 'auto_otp'; apiData.otp = text; }
        else return;

        try {
            const res = await axios.post('https://milastore.web.id/api/bot-wa/webhook', apiData, { headers: { 'X-API-KEY': API_KEY } });
            
            // 🚀 JALUR KHUSUS PENGIRIMAN OTP KE TARGET
            if (apiData.command === 'login' && res.data.status === true) {
                notifQueue.push({ type: 'text', jid: res.data.target_wa, msg: res.data.otp_message }); // Tembak OTP ke WA tujuan
                notifQueue.push({ type: 'text', jid: jid, msg: res.data.reply_message }); // Kasih notif ke pengirim
            } 
            else if (res.data.image_url) {
                notifQueue.push({ type: 'image', jid, url: res.data.image_url, cap: res.data.message });
            } 
            else if (res.data.message) {
                notifQueue.push({ type: 'text', jid, msg: res.data.message });
            }
            processQueue();
        } catch (e) {}
    });
}
startBot();
