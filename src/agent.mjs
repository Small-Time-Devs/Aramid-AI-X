import { config } from "./config/config.mjs";
import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";
import { checkRateLimit, updateRateLimitInfo } from "./utils/helpers.mjs";
import axios from 'axios';
import { saveTweetData } from './db/dynamo.mjs';
import { decryptPrivateKey } from './encryption/encryption.mjs';
import { storeTradeInfo } from './db/dynamo.mjs';
import { startPriceMonitoring } from './trading/pnl.mjs';
import { executeTradeBuy } from './trading/buy.mjs';

dotenv.config();
const url = 'https://api.smalltimedevs.com/ai/hive-engine'

export async function generateAutoPostTweet() {
    let tweetData;
    try {
      // Step 2 call the handleQuestion function
      tweetData = await handleQuestion();
      if (config.twitter.settings.devMode) {
        console.log('Development mode is enabled. Not posting to twitter. Generated tweet data:', tweetData);
      }
  
      while (!tweetData || !tweetData.tweet || !tweetData.comment) {
        console.log("Generated tweet is missing the tweet post or the comment post, retrying...");
        tweetData = await handleQuestion();
      }
      //console.log("Generated Tweet:", tweetData);
      return tweetData;
    } catch (error) {
      console.error("Error generating auto-post tweet, generating a new one!");
      tweetData = await handleQuestion();
    }
}

export async function handleQuestion() {
    let tokenData;
    try {
        tokenData = await fetchMeteoraTokenData();
        if (config.twitter.settings.devMode) {
            console.log('Development mode is enabled. Generated token data:', tokenData);
        }

    } catch (error) {
        console.error("Error fetching token data going to try again!", error);
        await handleQuestion();
    }

    // Step 4 call the generatePrompt function
    const prompt = await generatePrompt(tokenData);
    //console.log("Generated prompt:", prompt);

    // If the response is good for the prompt then we can move on to the next step of calling the api with the response.
    let agentResponses;
    try {
        // Step 5 call the external API with the prompt
        if (config.twitter.settings.devMode) {
        console.log("Sending request to external API with payload:", { query: prompt });
        }

        const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/twitter-agent-chat', { query: prompt });
        //console.log("Received response from external API:", response.data);
        agentResponses = response.data.agents;

    } catch (error) {
        console.error("Error connecting to external API:", error.response ? error.response.data : error.message);
        throw new Error("Failed to connect to external API.");
    }

    if (!agentResponses || agentResponses.length < 4) {
        throw new Error("Invalid agent responses received from API.");
    }

    const anaylstAgent = agentResponses[0];
    const analystResponse = anaylstAgent.response;
    const investmentAgent = agentResponses[1];
    const investmentReponse = investmentAgent.response;
    const investmentDecision = investmentAgent.decision;
    const tweetAgent = agentResponses[2];
    const commentAgent = agentResponses[3];
    const hashtagsAgent = agentResponses[4];

    if (config.twitter.settings.devMode) {
      console.log("Analyst Response:", analystResponse);
      console.log("Tweet Agent Response:", tweetAgent.response);
      console.log("Comment Agent Response:", commentAgent.response);
      console.log("Hashtags Agent Response:", hashtagsAgent.response);
      console.log("Investment Response:", investmentReponse);
      console.log("Investment Decision:", investmentDecision);
    }

    if (!analystResponse) {
      console.error("Invalid analyst response, generating again.");
      await handleQuestion();
    }
    if (!tweetAgent || !tweetAgent.name || !tweetAgent.response) {
        console.error("Invalid tweet agent response, generating again.");
        await handleQuestion();
    }
    if (!commentAgent || !commentAgent.name || !commentAgent.response) {
        console.error("Invalid comment agent response, generating again.");
        await handleQuestion();
    }
    if (!hashtagsAgent || !hashtagsAgent.name || !hashtagsAgent.response) {
        console.error("Invalid hashtags agent response, generating again.");
        await handleQuestion();
    }
    if (!investmentAgent || !investmentAgent.response || !investmentAgent.decision) {
        console.error("Invalid investment agent response, generating again.");
        await handleQuestion();
    }

    let tweet = `
    ${tweetAgent.name}: 
    ${tweetAgent.response}\n\n 
    
    ${commentAgent.name}:
    ${commentAgent.response}\n\n

    ${hashtagsAgent.name}:\n${hashtagsAgent.response}\n`;

    let comment = `
    ${anaylstAgent.name}:
    ${anaylstAgent.response}\n\n
    
    ${investmentAgent.name}:
    ${investmentAgent.response}\n
    ${investmentAgent.decision}`;
    
    let agetnAnalysisComment = `${anaylstAgent.name}:\n${anaylstAgent.response}`;
    let agentTweetPost = `${tweetAgent.name}:\n${tweetAgent.response}`;
    let agentComment = `${commentAgent.name}:\n${commentAgent.response}`;
    let agetnHashtagsComment = `${hashtagsAgent.name}:\n${hashtagsAgent.response}\n`;
    let agentInvestmentComment = `${investmentAgent.name}:\n${investmentAgent.response}`;
    let agentInvestmentDecisionComment = `${investmentAgent.decision}`;

    /*
    if (tweet.length > 280) {
        tweet = tweet.substring(0, 277) + '...';
    }
    if (comment.length > 280) {
        comment = comment.substring(0, 277) + '...';
    }
    if (hashtagsComment.length > 280) {
        hashtagsComment = hashtagsComment.substring(0, 277) + '...';
    }
    */

    const tweetData = {
        tweet,
        comment,
        agetnAnalysisComment,
        agentTweetPost,
        agentComment,
        agetnHashtagsComment,
        agentInvestmentComment,
        agentInvestmentDecisionComment,
        tokenData,
    };

    if (config.twitter.settings.devMode) {
        console.log('Development mode is enabled. Generated tweet data:', tweetData);
    }

    return tweetData;
}

async function generatePrompt(tokenData) {
  const {
    dateCreated,
    tokenName,
    tokenSymbol,
    tokenDescription,
    tokenAddress,
    tokenTwitterURL,
    tokenWebsiteURL,
    tokenPriceInSol,
    tokenPriceInUSD,
    tokenVolume24h,
    tokenPriceChange5m,
    tokenPriceChange1h,
    tokenPriceChange6h,
    tokenPriceChange24h,
    tokenLiquidityUSD,
    tokenLiquidityBase,
    tokenLiquidityQuote,
    tokenFDV,
    tokenMarketCap,
    tokenSafe,
    tokenFreezeAuthority,
    tokenMintAuthority,
    meteoraSpecific,
  } = tokenData;
  const influencers = config.twitter.influencers.twitterHandles;
  const randomInfluencer = influencers[Math.floor(Math.random() * influencers.length)];

  return `
    Token Information:
    Date Created: ${dateCreated}
    Token Name: ${tokenName}
    Token Symbol: ${tokenSymbol}
    Token Description: ${tokenDescription}
    Token Address: ${tokenAddress}
    Token Twitter URL: ${tokenTwitterURL}
    Token Website URL: ${tokenWebsiteURL}

    Price & Market Data:
    Token Price In Sol: ${tokenPriceInSol}
    Token Price In USD: ${tokenPriceInUSD}
    Token Volume 24h: ${tokenVolume24h}
    Token Price Change 5m: ${tokenPriceChange5m}
    Token Price Change 1h: ${tokenPriceChange1h}
    Token Price Change 6h: ${tokenPriceChange6h}
    Token Price Change 24h: ${tokenPriceChange24h}
    Token Liquidity USD: ${tokenLiquidityUSD}
    Token Liquidity Base: ${tokenLiquidityBase}
    Token Liquidity Quote: ${tokenLiquidityQuote}
    Token FDV: ${tokenFDV}
    Token Market Cap: ${tokenMarketCap}

    Security Info:
    Token Safe: ${tokenSafe}
    Has Freeze Authority: ${tokenFreezeAuthority}
    Has Mint Authority: ${tokenMintAuthority}

    Meteora Pool Info:
    Pool Address: ${meteoraSpecific?.pairAddress}
    Bin Step: ${meteoraSpecific?.binStep}
    Base Fee %: ${meteoraSpecific?.baseFeePercent}
    Max Fee %: ${meteoraSpecific?.maxFeePercent}
    Protocol Fee %: ${meteoraSpecific?.protocolFeePercent}
    Fees 24h: ${meteoraSpecific?.fees24h}
    Today's Fees: ${meteoraSpecific?.todayFees}
    Pool APR: ${meteoraSpecific?.apr}
    Pool APY: ${meteoraSpecific?.apy}
    Farm APR: ${meteoraSpecific?.farmApr}
    Farm APY: ${meteoraSpecific?.farmApy}

    Twitter Influencer:
    Random Influencer To Mention: ${randomInfluencer}
  `
}

export async function postToTwitter(tweetData, client) {
  try {
    console.log('Starting postToTwitter function with trade data:', {
      investmentDecision: tweetData.agentInvestmentDecisionComment,
      tokenDetails: {
        name: tweetData.tokenData.tokenName,
        address: tweetData.tokenData.tokenAddress,
        priceSOL: tweetData.tokenData.tokenPriceInSol,
        meteora: {
          apr: tweetData.tokenData.meteoraSpecific?.apr,
          apy: tweetData.tokenData.meteoraSpecific?.apy,
          pairAddress: tweetData.tokenData.meteoraSpecific?.pairAddress
        }
      }
    });

    let tradeResult = null;

    // Only proceed with trading if tradeTokens is enabled
    if (config.cryptoGlobals.tradeTokens && tweetData.agentInvestmentDecisionComment && 
        (tweetData.agentInvestmentDecisionComment.startsWith("Invest") || 
         tweetData.agentInvestmentDecisionComment.startsWith("Quick Profit"))) {
      
      let targetGain, targetLoss;
      let tradeType = null;

      if (tweetData.agentInvestmentDecisionComment.startsWith("Quick Profit")) {
        const gainMatch = tweetData.agentInvestmentDecisionComment.match(/Gain \+(\d+)%/);
        const lossMatch = tweetData.agentInvestmentDecisionComment.match(/Loss -(\d+)%/);
        
        targetGain = gainMatch ? parseFloat(gainMatch[1]) : 50;
        targetLoss = lossMatch ? parseFloat(lossMatch[1]) : 20;
        tradeType = 'QUICK_PROFIT';
      } else {
        // Regular Invest format
        const targetGainMatch = tweetData.agentInvestmentDecisionComment.match(/take profit at (\d+)%/i);
        const targetLossMatch = tweetData.agentInvestmentDecisionComment.match(/stop loss at (\d+)%/i);
        
        targetGain = targetGainMatch ? parseFloat(targetGainMatch[1]) : 50;
        targetLoss = targetLossMatch ? parseFloat(targetLossMatch[1]) : 20;
        tradeType = 'INVEST';
      }

      console.log('Extracted trade parameters:', { targetGain, targetLoss });
      
      // Execute trade and wait for result
      tradeResult = await executeTradeBuy(tweetData, targetGain, targetLoss, tradeType);
      
      if (!tradeResult.success) {
        console.error('Trade execution failed:', tradeResult.error);
      } else {
        console.log('Trade executed successfully. Trade ID:', tradeResult.tradeId);

        if (tradeResult.txId) {
          const tradeComment = `I put my money where my agent's mouth is! Check out the trade: https://solscan.io/tx/${tradeResult.txId} 🚀`;
          tweetData.comment = `${tweetData.comment}\n${tradeComment}`;

          // Add Meteora pool info if available
          if (tweetData.tokenData.meteoraSpecific) {
            const poolInfo = `\nMeteora Pool Stats:\nAPR: ${tweetData.tokenData.meteoraSpecific.apr}%\nAPY: ${tweetData.tokenData.meteoraSpecific.apy}%`;
            tweetData.comment = `${tweetData.comment}${poolInfo}`;
          }
        }
      }
    }

    // Twitter posting logic should execute regardless of dev mode
    if (config.twitter.settings.devMode) {
      console.log('Development mode is enabled. Skipping Twitter posts.');
      if (tradeResult && tradeResult.success) {
        console.log('Trade comment that would be posted:', tweetData.comment);
      }
      return;
    }

    const canPost = await checkRateLimit(client);
    if (!canPost) {
      console.log('Skipping post due to rate limit.');
      return;
    }

    //const formattedTweet = tweetData.tweet.replace(/\*\*/g, '').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
    //const { data: createdTweet, headers } = await client.v2.tweet(formattedTweet);
    const { data: createdTweet, headers } = await client.v2.tweet(tweetData.tweet);
    updateRateLimitInfo(headers);
    console.log('Tweet posted successfully:', createdTweet);

    if (tweetData.comment) {
      //const formattedComment = tweetData.comment.replace(/\*\*/g, '').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
      //const { headers: commentHeaders } = await client.v2.reply(formattedComment, createdTweet.id);
      const { headers: commentHeaders } = await client.v2.reply(tweetData.comment, createdTweet.id);
      updateRateLimitInfo(commentHeaders);
      console.log('Comment posted successfully:', tweetData.comment);
    }
       
    // Formated Token Data
    const formatedTokenData = JSON.stringify(tweetData.tokenData, null, 2);
    // 
    // Save tweet data to DynamoDB
    if (
      tweetData.tweet && 
      createdTweet.id && 
      tweetData.comment
    ) {
      await saveTweetData(
        createdTweet.id,                              // tweetId
        new Date().toISOString(),                     // date
        tweetData.tweet,                              // tweet
        tweetData.comment,                            // comment
        tweetData.agetnHashtagsComment,               // hashtagsComment
        tweetData.agetnAnalysisComment,               // analysisComment
        tweetData.agentTweetPost,                     // tweetPost
        tweetData.agentComment,                       // agentComment
        tweetData.agetnHashtagsComment,               // hashtagsContent
        tweetData.agentInvestmentComment,             // investmentComment
        tweetData.agentInvestmentDecisionComment,     // investmentDecision
        JSON.stringify(tweetData.tokenData, null, 2)  // tokenData
      );
    }

    return createdTweet;
  } catch (error) {
    if (error.code === 401) {
      console.error('Unauthorized: Check your Twitter API credentials.');
    } else if (error.code === 403) {
      console.error('Forbidden: You do not have permission to perform this action. Check your Twitter API permissions.');
    } else if (error.response && error.response.headers) {
      console.log('Error headers:', error.response.headers); // Log headers for debugging
      updateRateLimitInfo(error.response.headers);
      console.error('Error posting tweet:', error);
    } else {
      console.error('Error posting tweet:', error);
    }
    // Do not throw an error to keep the application running
    console.log('Continuing execution despite the error.');
  }
}

export async function scanAndRespondToOtherUserTweets(targetUserId) {
  const client = new TwitterApi({
    appKey: `${config.twitter.keys.appKey}`,
    appSecret: `${config.twitter.keys.appSecret}`,
    accessToken: `${config.twitter.keys.accessToken}`,
    accessSecret: `${config.twitter.keys.accessSecret}`,
  });

  try {
    // Fetch the latest tweets from the target user's timeline
    const { data } = await client.v2.userTimeline(targetUserId, { max_results: 5 });
    const tweets = data.data;

    if (!tweets || tweets.length === 0) {
      console.log('No tweets found for the specified user.');
      return;
    }

    for (const tweet of tweets) {
      if (tweet.in_reply_to_user_id === null) {
        // Send tweet text to OpenAI and generate a response
        const response = await generateResponseToTweet(tweet.text);

        // Post the response as a reply to the original tweet
        await client.v2.reply(response, tweet.id);
        console.log('Replied to tweet:', tweet.id);
      }
    }
  } catch (error) {
    console.error('Error scanning and responding to posts:', error);
  }
}

async function generateResponseToTweet(tweetText) {
  const prompt = `
    ### Twitter Response Generator

    You are a highly engaging and professional Twitter bot. Your job is to create a thoughtful and engaging response to the following tweet:
    
    Tweet: "${tweetText}"

    Response:
  `;

  try {
    console.log("Sending request to external API with payload:", { query: prompt });
    const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/agent-chat', { query: prompt });
    console.log("Received response from external API:", response.data);
    let generatedResponse = response.data.text.trim();
    generatedResponse = generatedResponse.replace(/\*\*/g, ''); // Remove Markdown bold formatting
    generatedResponse = generatedResponse.replace(/\n/g, ' \\n '); // Replace newlines with escaped newlines
    generatedResponse = generatedResponse.replace(/\s+/g, ' ').trim(); // Remove extra spaces
    if (generatedResponse.length > 280) {
      generatedResponse = generatedResponse.substring(0, 277) + '...'; // Ensure response is within 280 characters
    }
    return generatedResponse;
  } catch (error) {
    console.error("Error generating response to tweet:", error.response ? error.response.data : error.message);
  }
}