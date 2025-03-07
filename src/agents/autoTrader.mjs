import { config } from "../config/config.mjs";
import dotenv from "dotenv";
import { fetchWithTimeout, fetchLatestTokenData, fetchBoostedTokenData  } from "../utils/helpers.mjs";
import axios from 'axios';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { storeTradeInfo } from '../db/dynamo.mjs';
import { startPriceMonitoring } from '../trading/pnl.mjs';
import { executeTradeBuy, executeBackgroundTradeBuy } from '../trading/buy.mjs';
import { sendAnalysisMessage, sendRetryNotification } from '../utils/discord.mjs';

// step 1
export async function generateTradeAnswer() {
    let investmentChoice;
    try {
        investmentChoice = await pickToken();
        if (config.cryptoGlobals.tradeTokenDevMode) {
            console.log("Generated Investment Decision:", investmentChoice);
        }

        // Skip if the investment decision is a "Pass"
        if (investmentChoice?.agentInvestmentDecisionComment?.startsWith('Pass')) {
            console.log('Investment rejected by trading agent:', investmentChoice.agentInvestmentDecisionComment);
            return null;
        }

        // Updated validation to match new API response format
        if (!investmentChoice?.tokenData || 
            !investmentChoice?.agentAnalysisComment ||  // Fixed typo from agetnAnalysisComment
            !investmentChoice?.agentInvestmentDecisionComment) {
            console.log("Invalid investment choice - missing required fields:", {
                hasTokenData: !!investmentChoice?.tokenData,
                hasAnalysis: !!investmentChoice?.agentAnalysisComment,
                hasDecision: !!investmentChoice?.agentInvestmentDecisionComment
            });
            return null;
        }

        return investmentChoice;
    } catch (error) {
        console.error("Error generating Investment Decision:", error);
        return null;
    }
}

async function pickToken() {
    let tokenData;
    try {
        tokenData = await fetchLatestTokenData();
        if (config.cryptoGlobals.tradeTokenDevMode) {
          console.log('Token data:', tokenData);
        }

    } catch (error) {
        console.error("Error fetching token data going to try again!", error);
        return await pickToken();
    }

    // Send token data to Discord
    await sendAnalysisMessage('token', {
        tokenAddress: tokenData.tokenAddress,
        chainId: tokenData.chainId
    });

    const tokenAddress = tokenData.tokenAddress;
    const chainId = tokenData.chainId;
    const contractAddress = tokenAddress;
    const chain = chainId;

    let agentResponses;
    try {
        const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/autoTrading-agent-chat', {chain, contractAddress });
        if (config.cryptoGlobals.tradeTokenDevMode) {
          console.log("Received response from external API:", response.data);
        }
        agentResponses = response.data.agents;
    } catch (error) {
        console.error("Error connecting to external API:", error.response ? error.response.data : error.message);
        throw new Error("Failed to connect to external API.");
    }

    if (!agentResponses || !Array.isArray(agentResponses) || agentResponses.length === 0) {
        await sendRetryNotification();
        throw new Error("Invalid agent responses received from API.");
    }

    const tokenSleuthAgent = agentResponses[0];
    const agentAnalysisComment = tokenSleuthAgent.response;
    const agentInvestmentDecisionComment = tokenSleuthAgent.decision;

    // Send full analysis to Discord
    await sendAnalysisMessage('analysis', {
        analysis: agentAnalysisComment,
        decision: agentInvestmentDecisionComment
    });

    if (config.cryptoGlobals.tradeTokenDevMode) {
        console.log("Analysis Response:", agentAnalysisComment);
        console.log("Investment Decision:", agentInvestmentDecisionComment);
    }

    if (!agentInvestmentDecisionComment) {
        console.error("Invalid agent decision, generating again.");
        return await pickToken();
    }

    const investmentChoice = {
        agentAnalysisComment: agentAnalysisComment,        // Fixed property name
        agentInvestmentDecisionComment: agentInvestmentDecisionComment,
        tokenData,
    };

    return investmentChoice;
}

export async function executeTrade(investmentChoice) {
    if (!investmentChoice) {
        console.log('No valid investment choice provided, skipping trade execution');
        return;
    }

    try {

        let tradeResult = null;

        // Only proceed with trading if tradeTokens is enabled
        if (config.cryptoGlobals.tradeTokensInBackground && 
            investmentChoice.agentInvestmentDecisionComment && 
            (investmentChoice.agentInvestmentDecisionComment.startsWith("Quick Profit") || 
             investmentChoice.agentInvestmentDecisionComment.startsWith("Invest"))) {
          
          let targetGain, targetLoss;
          let tradeType;
          
          if (investmentChoice.agentInvestmentDecisionComment.startsWith("Quick Profit")) {
            const gainMatch = investmentChoice.agentInvestmentDecisionComment.match(/Gain \+(\d+)%/);
            const lossMatch = investmentChoice.agentInvestmentDecisionComment.match(/Loss -(\d+)%/);
            
            targetGain = gainMatch ? parseFloat(gainMatch[1]) : 50;
            targetLoss = lossMatch ? parseFloat(lossMatch[1]) : 20;
            tradeType = 'QUICK_PROFIT';
          } else {
            // Regular Invest format - Updated regex to handle both formats
            const targetGainMatch = investmentChoice.agentInvestmentDecisionComment.match(/(?:take profit at|Gain \+)(\d+)%/i);
            const targetLossMatch = investmentChoice.agentInvestmentDecisionComment.match(/(?:stop loss at|Loss -)(\d+)%/i);
            
            targetGain = targetGainMatch ? parseFloat(targetGainMatch[1]) : 50;
            targetLoss = targetLossMatch ? parseFloat(targetLossMatch[1]) : 20;
            tradeType = 'INVEST';
          }

          if (config.cryptoGlobals.tradeTokensInBackground) {
            console.log('Extracted trade parameters:', { 
              targetGain, 
              targetLoss,
              tradeType,
              timeLimit: tradeType === 'INVEST' ? 
                `${config.cryptoGlobals.investHoldingTimePeriodHours} hours` : 
                `${config.cryptoGlobals.quickProfitHoldingTimePeriodMinutes} minutes`
            });
          }

          tradeResult = await executeBackgroundTradeBuy(investmentChoice, targetGain, targetLoss, tradeType);
          
          if (!tradeResult.success) {
            console.error('Trade execution failed:', tradeResult.error);
          } else {
            console.log('Trade executed successfully. Trade ID:', tradeResult.tradeId);
          }

          if (tradeResult && tradeResult.success && tradeResult.txId) {
            console.log(`Check out the trade: https://solscan.io/tx/${tradeResult.txId} 🚀`);
          }
        } else if (!config.cryptoGlobals.tradeTokensInBackground) {
          console.log('Auto Trading is disabled in config. Skipping trade execution.');
        }
    } catch (error) {
        console.error('Error executing trade:', error);
    }
}