import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseUnits,
  encodeFunctionData,
  getAddress,
  keccak256,
  stringToBytes,
  concat,
} from "https://esm.sh/viem@2.31.3";
import { generatePrivateKey, privateKeyToAccount } from "https://esm.sh/viem@2.31.3/accounts";
import { speakBrowser } from "./speech.js";

const PULSECHAIN = {
  id: 369,
  name: "PulseChain",
  nativeCurrency: { name: "Pulse", symbol: "PLS", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.pulsechain.com"] } },
};

const PULSECHAIN_ADD = {
  chainId: "0x171",
  chainName: "PulseChain",
  nativeCurrency: { name: "Pulse", symbol: "PLS", decimals: 18 },
  rpcUrls: ["https://rpc.pulsechain.com"],
  blockExplorerUrls: ["https://scan.pulsechain.com"],
};

const INTERNET_MONEY_URL = "https://internetmoney.io/";
const NO_WALLET_MSG =
  "No wallet found. Get Internet Money, then come back.";

/** Where callers can get onto PulseChain / pick up PLS. */
const PULSECHAIN_PLACES = [
  { label: "Bridge", href: "https://bridge.pulsechain.com/" },
  { label: "PulseX", href: "https://app.pulsex.com/" },
  { label: "ChangeNOW", href: "https://changenow.io/currencies/pulse" },
  {
    label: "Getting started",
    href: "https://go.pulsechain.wiki/getting-started/getting-started",
  },
];
const NEED_PULSECHAIN_MSG =
  "Need PulseChain / PLS? Pick a place below, then come back.";

function appendLinkedPlaces(el, places) {
  places.forEach((p, i) => {
    if (i) el.append(document.createTextNode(" · "));
    const a = document.createElement("a");
    a.href = p.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = p.label;
    el.append(a);
  });
}

/** Status text; turns wallet / PulseChain help into real links. */
function setStatusMessage(el, message) {
  if (!el) return;
  const msg = String(message ?? "");
  if (/no wallet found/i.test(msg) && /internet money/i.test(msg)) {
    el.replaceChildren();
    el.append(document.createTextNode("No wallet found. Get "));
    const a = document.createElement("a");
    a.href = INTERNET_MONEY_URL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Internet Money";
    el.append(a);
    el.append(document.createTextNode(", then come back."));
    return;
  }
  if (
    /need pulsechain/i.test(msg) ||
    /need pls/i.test(msg) ||
    /could not add pulsechain/i.test(msg) ||
    /unrecognized chain|unknown chain|not added|4902/i.test(msg)
  ) {
    el.replaceChildren();
    el.append(
      document.createTextNode(
        "Need PulseChain / PLS? ",
      ),
    );
    appendLinkedPlaces(el, PULSECHAIN_PLACES);
    el.append(document.createTextNode(" — then come back."));
    return;
  }
  el.textContent = msg;
}

const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE".toLowerCase();
const DEMO_KEY = "pulsetext.demo.pk";

const els = {
  connectBtn: document.getElementById("connectBtn"),
  revokeAllBtn: document.getElementById("revokeAllBtn"),
  walletLine: document.getElementById("walletLine"),
  assetSelect: document.getElementById("assetSelect"),
  depositAmount: document.getElementById("depositAmount"),
  callerName: document.getElementById("callerName"),
  ttsText: document.getElementById("ttsText"),
  noMessage: document.getElementById("noMessage"),
  thanksLine: document.getElementById("thanksLine"),
  speakBtn: document.getElementById("speakBtn"),
  testPlayBtn: document.getElementById("testPlayBtn"),
  speakStatus: document.getElementById("speakStatus"),
  priceHint: document.getElementById("priceHint"),
  treasuryLine: document.getElementById("treasuryLine"),
  assetPrice: document.getElementById("assetPrice"),
  assetPriceHint: document.getElementById("assetPriceHint"),
  stageSend: document.getElementById("stageSend"),
  howtoBtn: document.getElementById("howtoBtn"),
  howtoModal: document.getElementById("howtoModal"),
  howtoModalClose: document.getElementById("howtoModalClose"),
  addPulseChainBtn: document.getElementById("addPulseChainBtn"),
  addPulseChainStatus: document.getElementById("addPulseChainStatus"),
};

/** @type {{ address?: `0x${string}`, assets: any[], treasury?: string, emulate?: boolean, account?: any }} */
const state = { assets: [] };

function short(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function apiBase() {
  const q = new URLSearchParams(location.search).get("api");
  if (q) return String(q).replace(/\/+$/, "");
  const meta = document.querySelector('meta[name="pulsetext-api"]');
  const fromMeta = meta?.getAttribute("content")?.trim();
  if (fromMeta) return fromMeta.replace(/\/+$/, "");
  if (typeof window.__PULSETEXT_API__ === "string" && window.__PULSETEXT_API__.trim()) {
    return window.__PULSETEXT_API__.trim().replace(/\/+$/, "");
  }
  return "";
}

function looksLikeHtml(text) {
  const t = String(text || "").trim().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<title>");
}

function apiOfflineMessage(detail) {
  const base = apiBase();
  if (!base) {
    return "Tip API not set. Edit config.js — set __PULSETEXT_API__ to your VPS tip relay HTTPS origin.";
  }
  if (looksLikeHtml(detail) || /site not found|404/i.test(String(detail || ""))) {
    return `Tip API unreachable at ${base}. Check the VPS relay is up, and Website origin allows this tip page.`;
  }
  const msg = String(detail || "offline").trim().replace(/\s+/g, " ");
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}

async function api(path, init) {
  const base = apiBase();
  if (!base && /github\.io$/i.test(location.hostname)) {
    throw new Error(
      "Tip API not set. Edit config.js — set __PULSETEXT_API__ to your VPS tip relay HTTPS origin.",
    );
  }
  const res = await fetch(`${base}${path}`, init);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }
  const bodyText = await res.text();
  if (!res.ok || looksLikeHtml(bodyText)) {
    throw new Error(apiOfflineMessage(bodyText || res.statusText));
  }
  return bodyText;
}

function paintWallet() {
  if (!els.walletLine) return;
  if (!state.address) {
    els.walletLine.textContent = "Wallet connects when you send.";
    if (els.connectBtn) els.connectBtn.textContent = state.emulate ? "Demo wallet" : "Connect";
    return;
  }
  els.walletLine.textContent = state.emulate ? `${short(state.address)} · demo` : short(state.address);
  if (els.connectBtn) els.connectBtn.textContent = short(state.address);
}

function markSent() {
  els.stageSend?.classList.toggle("is-done", Boolean(state.lastSentId));
}

function tipOnlyChecked() {
  return Boolean(els.noMessage?.checked);
}

function lineText() {
  return tipOnlyChecked() ? "" : (els.ttsText?.value || "").trim();
}

function syncNoMessage() {
  const off = tipOnlyChecked();
  if (!els.ttsText) return;
  els.ttsText.disabled = off;
  els.ttsText.placeholder = off ? "No message" : "What should they hear…";
  updatePriceHint();
}

function requireLineOrNoMessage() {
  if (tipOnlyChecked() || lineText()) return;
  throw new Error("Write a line, or tick no message");
}

function showThanks(msg) {
  if (!els.thanksLine) return;
  els.thanksLine.hidden = false;
  els.thanksLine.textContent = msg;
}

function hideThanks() {
  if (!els.thanksLine) return;
  els.thanksLine.hidden = true;
  els.thanksLine.textContent = "";
}

function resetLineAfterSend() {
  if (els.ttsText) els.ttsText.value = "";
  if (els.noMessage) els.noMessage.checked = false;
  syncNoMessage();
}

function loadOrCreateDemoAccount() {
  let pk = localStorage.getItem(DEMO_KEY);
  if (!pk) {
    pk = generatePrivateKey();
    localStorage.setItem(DEMO_KEY, pk);
  }
  return privateKeyToAccount(pk);
}

async function boot() {
  const [health, assets] = await Promise.all([
    api("/health"),
    api("/v1/assets"),
  ]);
  state.treasury = assets.treasury;
  state.assets = assets.assets;
  state.emulate = Boolean(health.emulate);
  paintTreasury(assets);

  if (state.emulate && els.connectBtn) {
    els.connectBtn.textContent = "Demo wallet";
  }

  els.assetSelect.innerHTML = state.assets
    .map(
      (a) =>
        `<option value="${a.address}">${a.symbol}${a.native ? " (native)" : ""}</option>`,
    )
    .join("");

  updatePriceHint();
  paintAssetPrice();
  paintWallet();
  markSent();
  setInterval(() => {
    refreshAssets().catch(() => {});
  }, 30_000);

  if (state.emulate && localStorage.getItem(DEMO_KEY)) {
    await connectDemo().catch(() => {});
  }
}

const MAX_TIP_USD = 1_000_000;
const MICROS_PER_USD = 1_000_000;
const MICROS_PER_CENT = 10_000;

function roundUsdMicrosToCents(micros) {
  const n = Number(micros);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / MICROS_PER_CENT) * MICROS_PER_CENT;
}

function parseTipUsdMicros(str) {
  const cleaned = (str || "").trim().replace(/[$,_\s]/g, "");
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Tip is dollars and cents — try 5 or 5.00");
  }
  const usd = Number(cleaned);
  if (!Number.isFinite(usd) || usd < 0) throw new Error("Enter a dollar tip");
  if (usd > 0 && usd < 0.01) throw new Error("Smallest tip is $0.01");
  if (usd > MAX_TIP_USD) throw new Error(`Tip max is $${MAX_TIP_USD.toLocaleString()}`);
  return roundUsdMicrosToCents(Math.round(usd * MICROS_PER_USD));
}

function formatAssetUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return "";
  if (x >= 1) {
    return `$${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  if (x >= 0.01) return `$${x.toFixed(4)}`;
  const s = x.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return `$${s}`;
}

function paintAssetPrice() {
  const asset = selectedAsset();
  const px = formatAssetUsd(asset?.usdPerToken);
  const line = asset && px ? `${asset.symbol} ${px}` : "—";
  if (els.assetPrice) els.assetPrice.textContent = line;
  if (els.assetPriceHint) els.assetPriceHint.textContent = px ? `1 ${asset.symbol} = ${px}` : "";
}

function usdMicrosToTokenAmount(usdMicros, asset) {
  const usdPer = Number(asset.usdPerToken);
  if (!usdPer || usdPer <= 0) throw new Error(`No price for ${asset.symbol}`);
  const tokens = usdMicros / MICROS_PER_USD / usdPer;
  if (!Number.isFinite(tokens) || tokens <= 0) throw new Error("Tip is too small for this coin");
  const places = Math.min(Number(asset.decimals) || 18, 8);
  return tokens.toFixed(places);
}

function updatePriceHint() {
  let tipUsd = 0;
  try {
    tipUsd = parseTipUsdMicros(els.depositAmount.value) / MICROS_PER_USD;
  } catch {
    els.priceHint.textContent = "";
    paintAssetPrice();
    return;
  }
  const asset = selectedAsset();
  const parts = [];
  if (tipUsd > 0) {
    parts.push(`tip $${tipUsd.toFixed(2)}`);
    if (asset?.usdPerToken) {
      const tokens = tipUsd / Number(asset.usdPerToken);
      parts.push(`~${tokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${asset.symbol}`);
    }
  }
  els.priceHint.textContent = parts.join(" · ");
  paintAssetPrice();
}

/** Same hash the server checks — baked into the payment tx. No extra signature. */
function lineCommit(name, text) {
  const n = String(name || "").trim();
  const t = String(text || "").trim();
  return keccak256(stringToBytes(`pulsetext.line.v1\0${n}\0${t}`));
}

async function ensurePulseChain() {
  const eth = window.ethereum;
  if (!eth) throw new Error(NO_WALLET_MSG);
  const chainId = await eth.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) === 369) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: PULSECHAIN_ADD.chainId }],
    });
  } catch (err) {
    const missing =
      err?.code === 4902 ||
      /unrecognized|not added|unknown chain/i.test(String(err?.message || ""));
    if (!missing) {
      // User rejected switch, or wallet can't switch — point them at on-ramps.
      const rejected =
        err?.code === 4001 ||
        /reject|denied|cancel/i.test(String(err?.message || ""));
      throw new Error(
        rejected
          ? NEED_PULSECHAIN_MSG
          : err?.message || NEED_PULSECHAIN_MSG,
      );
    }
    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [PULSECHAIN_ADD],
      });
    } catch (addErr) {
      throw new Error(addErr?.message || NEED_PULSECHAIN_MSG);
    }
  }
}

async function addPulseChainFromHowto() {
  const status = els.addPulseChainStatus;
  setStatusMessage(status, "Check your wallet…");
  try {
    if (state.emulate && !window.ethereum) {
      setStatusMessage(status, "Demo mode — PulseChain is already on");
      return;
    }
    if (!window.ethereum) {
      throw new Error(NO_WALLET_MSG);
    }
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
    } catch {
      /* some wallets allow add-chain without unlocking first */
    }
    await ensurePulseChain();
    setStatusMessage(status, "PulseChain is in your wallet");
  } catch (err) {
    setStatusMessage(status, err?.message || NEED_PULSECHAIN_MSG);
  }
}

async function connectDemo() {
  const account = loadOrCreateDemoAccount();
  state.account = account;
  state.address = account.address;
  state.walletClient = createWalletClient({
    account,
    chain: PULSECHAIN,
    transport: http("https://rpc.pulsechain.com"),
  });
  await api("/v1/emulate/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: state.address }),
  });
  paintWallet();
  markSent();
}

async function connectInjected() {
  await ensurePulseChain();
  const eth = window.ethereum;
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  state.address = getAddress(accounts[0]);
  state.walletClient = createWalletClient({
    account: state.address,
    chain: PULSECHAIN,
    transport: custom(eth),
  });
  state.publicClient = createPublicClient({
    chain: PULSECHAIN,
    transport: custom(eth),
  });
  paintWallet();
}

async function connect() {
  if (state.emulate) {
    await connectDemo();
  } else {
    await connectInjected();
  }
}

function selectedAsset() {
  const address = els.assetSelect.value;
  return state.assets.find((a) => a.address.toLowerCase() === address.toLowerCase());
}

function paintTreasury(data) {
  if (!els.treasuryLine) return;
  if (data.treasuryReady === false) {
    els.treasuryLine.textContent = "Host hasn’t set a wallet yet";
    return;
  }
  if (data.treasury) els.treasuryLine.textContent = data.treasury;
}

async function refreshAssets() {
  const data = await api("/v1/assets");
  state.assets = data.assets;
  state.treasury = data.treasury || state.treasury;
  paintTreasury(data);
  const keep = els.assetSelect?.value;
  if (els.assetSelect) {
    els.assetSelect.innerHTML = state.assets
      .map(
        (a) =>
          `<option value="${a.address}">${a.symbol}${a.native ? " (native)" : ""}</option>`,
      )
      .join("");
    if (keep && state.assets.some((a) => a.address.toLowerCase() === keep.toLowerCase())) {
      els.assetSelect.value = keep;
    }
  }
  updatePriceHint();
  return selectedAsset();
}

async function requestQuote(tipUsdMicros) {
  const asset = (await refreshAssets().catch(() => selectedAsset())) || selectedAsset();
  if (!asset) throw new Error("Pick a coin");
  const name = (els.callerName.value || "").trim();
  if (!name) throw new Error("Enter your name");
  requireLineOrNoMessage();
  const text = lineText();
  els.speakStatus.textContent = "Getting tip quote…";
  return api("/v1/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tipUsdMicros,
      asset: asset.address,
      fromAddress: state.address,
      name,
      text,
      tipOnly: !text,
    }),
  });
}

async function sendPayment(quote, commit) {
  const assetAddr = getAddress(quote.expectedAsset);
  const amount = BigInt(quote.expectedAmountRaw);
  if (amount <= 0n) throw new Error("Invalid tip quote");
  if (!commit) throw new Error("Missing line commit");

  if (state.emulate) {
    els.speakStatus.textContent = "Sending payment…";
    const paid = await api("/v1/emulate/deposit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromAddress: state.address,
        asset: assetAddr,
        amountRaw: amount.toString(),
        commit,
      }),
    });
    return { txHash: paid.txHash, creditUsd: paid.creditUsd };
  }

  const treasury = getAddress(state.treasury);
  els.speakStatus.textContent = "Confirm payment in wallet…";
  let txHash;
  if (assetAddr.toLowerCase() === NATIVE) {
    txHash = await state.walletClient.sendTransaction({
      to: treasury,
      value: amount,
      data: commit,
      account: state.address,
      chain: PULSECHAIN,
    });
  } else {
    txHash = await state.walletClient.sendTransaction({
      to: assetAddr,
      data: concat([
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [treasury, amount],
        }),
        commit,
      ]),
      account: state.address,
      chain: PULSECHAIN,
    });
  }
  els.speakStatus.textContent = `Payment ${txHash.slice(0, 10)}… confirming`;
  // Confirm on public Pulse RPC. Wallet RPCs often time out after a real success.
  // Once we have a tx hash, never surface that as a hard failure — desk verifies on pull.
  const confirmClient = createPublicClient({
    chain: PULSECHAIN,
    transport: http("https://rpc.pulsechain.com"),
  });
  let confirmed = false;
  try {
    const receipt = await confirmClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 120_000,
      pollingInterval: 2_000,
    });
    if (receipt?.status === "reverted") {
      throw new Error("Payment reverted on PulseChain");
    }
    confirmed = receipt?.status === "success";
  } catch (err) {
    if (/reverted/i.test(String(err?.message || err))) throw err;
    for (let i = 0; i < 8 && !confirmed; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const late = await confirmClient
        .getTransactionReceipt({ hash: txHash })
        .catch(() => null);
      if (late?.status === "reverted") {
        throw new Error("Payment reverted on PulseChain");
      }
      if (late?.status === "success") confirmed = true;
    }
    if (!confirmed) {
      els.speakStatus.textContent =
        `Payment sent ${txHash.slice(0, 10)}… finishing with host`;
    }
  }
  // Relay has no /v1/deposit — desk verifies after /v1/line pull. Ignore deposit errors.
  try {
    const paid = await api("/v1/deposit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txHash,
        fromAddress: state.address,
        asset: assetAddr,
        amountRaw: amount.toString(),
        logIndex: 0,
      }),
    });
    return { txHash, creditUsd: paid.creditUsd, confirmed };
  } catch {
    return { txHash, creditUsd: null, confirmed };
  }
}

async function deliverLine(txHash, spendId) {
  const text = lineText();
  const name = (els.callerName.value || "").trim();
  if (!name) throw new Error("Enter your name");
  if (!spendId) throw new Error("Missing tip quote");
  requireLineOrNoMessage();
  els.speakStatus.textContent = text
    ? "Sending line to show…"
    : "Sending tip to show…";
  return api("/v1/line", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      spendId,
      text,
      name,
      fromAddress: state.address,
      txHash,
      tipOnly: !text,
    }),
  });
}

/** One button: connect if needed, tip once, line lands. */
async function sendToShow() {
  hideThanks();
  if (!state.address || !state.walletClient) {
    els.speakStatus.textContent = state.emulate ? "Opening demo wallet…" : "Connect wallet…";
    await connect();
  }
  const name = (els.callerName.value || "").trim();
  if (!name) throw new Error("Enter your name");
  requireLineOrNoMessage();

  const tipUsdMicros = parseTipUsdMicros(els.depositAmount.value);
  if (!tipUsdMicros) throw new Error("Enter a dollar tip");

  const quote = await requestQuote(tipUsdMicros);
  if (!quote?.spendId || !quote?.expectedAmountRaw) {
    throw new Error("Tip quote failed");
  }

  const commit = lineCommit(name, lineText());
  const paid = await sendPayment(quote, commit);
  if (!paid?.txHash) throw new Error("Payment did not return a tx");
  const json = await deliverLine(paid.txHash, quote.spendId);
  resetLineAfterSend();
  els.speakStatus.textContent = "";
  const usd =
    json.chargedUsd && json.chargedUsd !== "0.00"
      ? json.chargedUsd
      : formatUsdFromMicros(quote.tipUsdMicros) || "tip";
  const hostPull = json.delivery === "host_pull" || json.paymentStatus === "not_verified";
  showThanks(
    json.tipOnly
      ? hostPull
        ? `Thanks. $${usd} tip sent — host desk will verify shortly.`
        : `Thanks. $${usd} tip is in — host decides what airs.`
      : hostPull
        ? `Thanks. You're in · $${usd}. Host desk will verify shortly.`
        : `Thanks. You're in · $${usd}. Host decides what airs.`,
  );
  state.lastSentId = json.spendId;
  paintWallet();
  markSent();
}

function formatUsdFromMicros(micros) {
  const n = Number(micros);
  if (!Number.isFinite(n) || n <= 0) return "";
  return (n / 1_000_000).toFixed(2);
}

function setRevokeStatus(msg) {
  if (els.speakStatus) els.speakStatus.textContent = msg;
  if (els.walletLine) els.walletLine.textContent = msg;
}

async function revokeAllApprovals() {
  if (state.emulate) {
    setRevokeStatus("Demo — nothing to revoke");
    return;
  }
  if (!state.address || !state.walletClient) {
    setRevokeStatus("Connect wallet…");
    await connect();
  }
  if (!state.publicClient && window.ethereum) {
    state.publicClient = createPublicClient({
      chain: PULSECHAIN,
      transport: custom(window.ethereum),
    });
  }
  if (!state.publicClient) throw new Error("Connect a wallet to revoke");
  await ensurePulseChain();
  const treasury = getAddress(state.treasury);
  const tokens = (state.assets || []).filter(
    (a) => a?.address && a.address.toLowerCase() !== NATIVE,
  );
  if (!tokens.length) throw new Error("No tokens to revoke");

  let revoked = 0;
  for (const token of tokens) {
    const tokenAddr = getAddress(token.address);
    let allowance = 0n;
    try {
      allowance = await state.publicClient.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [getAddress(state.address), treasury],
      });
    } catch {
      continue;
    }
    if (!allowance || allowance === 0n) continue;
    setRevokeStatus(`Revoking ${token.symbol}…`);
    const hash = await state.walletClient.sendTransaction({
      to: tokenAddr,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [treasury, 0n],
      }),
      account: state.address,
      chain: PULSECHAIN,
    });
    await state.publicClient.waitForTransactionReceipt({ hash });
    revoked += 1;
  }
  setRevokeStatus(
    revoked
      ? `Revoked ${revoked} approval${revoked === 1 ? "" : "s"} to this show`
      : "No approvals to this show",
  );
}

function testPlay() {
  requireLineOrNoMessage();
  const text = lineText();
  const name = (els.callerName.value || "").trim() || "Caller";
  const spoken = text ? `${name}. ${text}` : name;
  els.speakStatus.textContent = text
    ? "Test play only — nothing sent"
    : "Test play — name only, nothing sent";
  return speakBrowser(spoken, { engine: "browser" });
}

function openHowto() {
  if (!els.howtoModal) return;
  els.howtoModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeHowto() {
  if (!els.howtoModal || els.howtoModal.hidden) return;
  els.howtoModal.hidden = true;
  document.body.style.overflow = "";
}

els.howtoBtn?.addEventListener("click", openHowto);
els.addPulseChainBtn?.addEventListener("click", () => addPulseChainFromHowto());
els.howtoModalClose?.addEventListener("click", closeHowto);
els.howtoModal?.querySelector("[data-howto-dismiss]")?.addEventListener("click", closeHowto);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeHowto();
});

els.connectBtn?.addEventListener("click", () =>
  connect().catch((e) => {
    setStatusMessage(els.walletLine, e.message);
  }),
);
els.revokeAllBtn?.addEventListener("click", () =>
  revokeAllApprovals().catch((e) => {
    setRevokeStatus(e.message || "Revoke failed");
  }),
);
els.speakBtn.addEventListener("click", () =>
  sendToShow().catch((e) => {
    const msg = String(e?.message || e || "Send failed");
    // Never leave callers thinking a timed-out receipt poll means the tip failed.
    if (/timed out|timeout/i.test(msg)) {
      setStatusMessage(
        els.speakStatus,
        "Confirmation is slow — if your wallet shows success, the tip was sent. Check the show / try refresh.",
      );
      return;
    }
    setStatusMessage(els.speakStatus, msg);
  }),
);
els.testPlayBtn.addEventListener("click", () => {
  testPlay().catch((e) => {
    setStatusMessage(els.speakStatus, e.message);
  });
});
els.ttsText.addEventListener("input", () => {
  hideThanks();
  if (els.ttsText.value.trim() && els.noMessage?.checked) {
    els.noMessage.checked = false;
    syncNoMessage();
    return;
  }
  updatePriceHint();
});
els.noMessage?.addEventListener("change", () => {
  hideThanks();
  syncNoMessage();
});
els.depositAmount.addEventListener("input", updatePriceHint);
els.assetSelect.addEventListener("change", updatePriceHint);
syncNoMessage();

boot().catch((e) => {
  if (els.walletLine) els.walletLine.textContent = apiOfflineMessage(e.message);
});
