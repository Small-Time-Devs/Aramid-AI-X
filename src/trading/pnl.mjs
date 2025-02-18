import { getTrade, getActiveTrades } from '../db/dynamo.mjs';
import { executeTradeSell } from './sell.mjs';
import { fetchTokenPairs } from '../utils/apiUtils.mjs';
import { config } from '../config/config.mjs';
import { config as dotEnvConfig} from 'dotenv';

const activeTrades = new Map();
const MONITOR_INTERVAL = 5000; // 5 seconds
const MAX_REQUESTS_PER_MINUTE = 300;
const requestTimes = [];

function canMakeRequest() {
  const now = Date.now();
  // Remove requests older than 1 minute
  while (requestTimes.length > 0 && requestTimes[0] < now - 60000) {
    requestTimes.shift();
  }
  return requestTimes.length < MAX_REQUESTS_PER_MINUTE;
}

function trackRequest() {
  requestTimes.push(Date.now());
}

export async function startPriceMonitoring(tradeId) {
  if (activeTrades.has(tradeId)) return;

  const monitor = async () => {
    try {
      if (!canMakeRequest()) {
        console.log('Rate limit approaching, skipping this check');
        setTimeout(() => monitor(), MONITOR_INTERVAL);
        return;
      }

      const trade = await getTrade(tradeId);
      if (!trade || trade.status !== 'ACTIVE') {
        activeTrades.delete(tradeId);
        return;
      }

      trackRequest();
      const tokenData = await fetchTokenPairs('solana', trade.tokenAddress);
      
      if (!tokenData) {
        console.error(`Failed to fetch token data for ${trade.tokenAddress}`);
        setTimeout(() => monitor(), MONITOR_INTERVAL);
        return;
      }

      const currentPrice = tokenData.priceNative;
      const priceChangePercent = calculatePriceChange(currentPrice, trade.entryPriceSOL);

      if (config.twitter.settings.devMode) {
        console.log(`[${new Date().toISOString()}] Monitoring trade ${tradeId}:`, {
            currentPrice,
            entryPrice: trade.entryPriceSOL,
            priceChange: priceChangePercent,
            targetGain: trade.targetPercentageGain,
            targetLoss: trade.targetPercentageLoss
        });
      }

      if (shouldSell(priceChangePercent, trade)) {
        await executeTradeSell(trade, currentPrice);
        activeTrades.delete(tradeId);
        return;
      }

      setTimeout(() => monitor(), MONITOR_INTERVAL);
    } catch (error) {
      console.error(`Error monitoring trade ${tradeId}:`, error);
      setTimeout(() => monitor(), MONITOR_INTERVAL * 2); // Double the interval on error
    }
  };

  activeTrades.set(tradeId, true);
  monitor();
}

export async function initializeTradeMonitoring() {
  try {
    console.log('Initializing trade monitoring...');
    const activeTradesFromDB = await getActiveTrades();
    
    if (activeTradesFromDB.length > 0) {
      console.log(`Found ${activeTradesFromDB.length} active trades to monitor`);
      
      for (const trade of activeTradesFromDB) {
        if (!activeTrades.has(trade.tradeId)) { // Using the Map instance
          console.log(`Starting monitoring for trade ${trade.tradeId}`);
          startPriceMonitoring(trade.tradeId);
        }
      }
    } else {
      console.log('No active trades found to monitor');
    }
  } catch (error) {
    console.error('Error initializing trade monitoring:', error);
  }
}

function calculatePriceChange(currentPrice, entryPrice) {
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

function shouldSell(priceChangePercent, trade) {
  return priceChangePercent >= trade.targetPercentageGain || 
         priceChangePercent <= -trade.targetPercentageLoss;
}
