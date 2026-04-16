const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// API Keys
const CMC_API_KEY = 'c8f1c7f0cf1d49ce9fd09f2cdcb50346';
const OPENSEA_API_KEY = 'ddcaac6b9c624a58be000387dd275a17';
const MORALIS_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjkyNjE0YmNlLTM2Y2EtNGI5NC04NDA2LWI0NWZhZjQ0YjI5NyIsIm9yZ0lkIjoiNDkxNTU1IiwidXNlcklkIjoiNTA1NzYyIiwidHlwZUlkIjoiYWU0OWFhNDAtYWMwMi00Yjg3LTk3ODYtZjIwMGNlNzA3MjhiIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NjkwODEzMTUsImV4cCI6NDkyNDg0MTMxNX0.Dx0S4iez6ViCAhIqCZwKUGovWoENfWyAuRD0XRf_SuE';
const COINGECKO_API_KEY = 'CG-uMxtefFCzfudm3L9ryHKQTz5';

// Helper to make HTTPS requests
function fetchJSON(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'MarketSnapshot/1.0',
                ...headers
            }
        };

        console.log(`  Fetching: ${urlObj.hostname}${urlObj.pathname}`);

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    console.log(`  Parse error: ${e.message}`);
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (e) => {
            console.log(`  Request error: ${e.message}`);
            reject(e);
        });
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

// ============ TRADING ECONOMICS SCRAPER (Gold) ============
async function scrapeGoldFromTradingEconomics() {
    console.log('  Scraping Gold from TradingEconomics...');
    try {
        const url = 'https://tradingeconomics.com/commodity/gold';
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });
        
        if (!response.ok) {
            console.log(`  TradingEconomics: HTTP ${response.status}`);
            return null;
        }
        
        const html = await response.text();
        
        // Look for the Gold row in the commodities table:
        // | [Gold](/commodity/gold) | 4629.83 | 43.40 | 0.95% |
        const goldTableMatch = html.match(/\[Gold\][^\|]*\|\s*([\d,.]+)\s*\|\s*([\d,.]+)\s*\|\s*([+-]?[\d.]+)%/i);
        
        if (goldTableMatch) {
            const price = parseFloat(goldTableMatch[1].replace(',', ''));
            const change = parseFloat(goldTableMatch[3]);
            console.log(`  TradingEconomics Gold (table): price=${price}, change=${change}%`);
            return { price, change };
        }
        
        // Fallback: Try to extract from the summary text
        // "Gold rose to 4,628.71 USD/t.oz on January 14, 2026, up 0.92% from the previous day"
        const summaryMatch = html.match(/Gold\s+(?:rose|fell)\s+to\s+([\d,]+\.?\d*)\s*USD.*?(?:up|down)\s+([\d.]+)%/i);
        if (summaryMatch) {
            const price = parseFloat(summaryMatch[1].replace(',', ''));
            const change = html.includes('fell') || html.includes('down') ? -parseFloat(summaryMatch[2]) : parseFloat(summaryMatch[2]);
            console.log(`  TradingEconomics Gold (summary): price=${price}, change=${change}%`);
            return { price, change };
        }
        
        console.log('  TradingEconomics: Could not parse gold data');
        return null;
    } catch (e) {
        console.error(`  TradingEconomics Error: ${e.message}`);
        return null;
    }
}

// ============ FINANCE (Yahoo Finance + TradingEconomics) ============
async function getFinance() {
    console.log('\n📊 Fetching Finance data...');
    
    // Yahoo Finance assets (S&P 500 and DXY)
    const yahooAssets = [
        { symbol: '%5EGSPC', name: 'S&P 500', link: 'https://www.tradingview.com/symbols/SPX/' },
        { symbol: 'DX-Y.NYB', name: 'DXY', link: 'https://www.tradingview.com/symbols/TVC-DXY/' }
    ];

    const results = [];
    
    // Fetch S&P 500 and DXY from Yahoo Finance
    for (const asset of yahooAssets) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${asset.symbol}?interval=1d&range=2d`;
            const response = await fetchJSON(url);
            
            console.log(`  ${asset.name}: status=${response.status}`);
            
            if (response.status === 200 && response.data.chart?.result?.[0]) {
                const quote = response.data.chart.result[0];
                const meta = quote.meta;
                const price = meta.regularMarketPrice;
                const previousClose = meta.chartPreviousClose || meta.previousClose;
                const change = previousClose ? ((price - previousClose) / previousClose) * 100 : 0;
                
                console.log(`  ${asset.name}: price=${price}, change=${change.toFixed(2)}%`);
                results.push({ name: asset.name, link: asset.link, price, change });
            } else {
                console.log(`  ${asset.name}: Failed - ${JSON.stringify(response.data).substring(0, 100)}`);
                results.push({ name: asset.name, link: asset.link, price: null, change: null });
            }
        } catch (e) {
            console.error(`  ${asset.name}: Error - ${e.message}`);
            results.push({ name: asset.name, link: asset.link, price: null, change: null });
        }
    }
    
    // Fetch Gold from TradingEconomics (spot price)
    const goldData = await scrapeGoldFromTradingEconomics();
    if (goldData) {
        results.splice(1, 0, { 
            name: 'GOLD', 
            link: 'https://tradingeconomics.com/commodity/gold', 
            price: goldData.price, 
            change: goldData.change 
        });
    } else {
        // Fallback to Yahoo Finance futures if scraping fails
        console.log('  Gold: Falling back to Yahoo Finance futures...');
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=2d`;
            const response = await fetchJSON(url);
            if (response.status === 200 && response.data.chart?.result?.[0]) {
                const quote = response.data.chart.result[0];
                const meta = quote.meta;
                const price = meta.regularMarketPrice;
                const previousClose = meta.chartPreviousClose || meta.previousClose;
                const change = previousClose ? ((price - previousClose) / previousClose) * 100 : 0;
                results.splice(1, 0, { name: 'GOLD', link: 'https://finance.yahoo.com/quote/GC=F', price, change });
            } else {
                results.splice(1, 0, { name: 'GOLD', link: 'https://tradingeconomics.com/commodity/gold', price: null, change: null });
            }
        } catch (e) {
            results.splice(1, 0, { name: 'GOLD', link: 'https://tradingeconomics.com/commodity/gold', price: null, change: null });
        }
    }
    
    return results;
}

// ============ CRYPTO (CoinGecko) ============
async function getCrypto() {
    console.log('\n🌙 Fetching Crypto data...');
    const cryptos = [
        { id: 'bitcoin', name: 'BTC', link: 'https://www.coingecko.com/en/coins/bitcoin' },
        { id: 'ethereum', name: 'ETH', link: 'https://www.coingecko.com/en/coins/ethereum' },
        { id: 'solana', name: 'SOL', link: 'https://www.coingecko.com/en/coins/solana' }
    ];

    try {
        const ids = cryptos.map(c => c.id).join(',');
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
        const response = await fetchJSON(url);

        console.log(`  CoinGecko status: ${response.status}`);

        if (response.status === 200 && response.data) {
            const results = cryptos.map(crypto => {
                const data = response.data[crypto.id];
                console.log(`  ${crypto.name}: price=${data?.usd}, change=${data?.usd_24h_change?.toFixed(2)}%`);
                return {
                    name: crypto.name,
                    link: crypto.link,
                    price: data?.usd || null,
                    change: data?.usd_24h_change || null
                };
            });
            return results;
        } else {
            console.log(`  CoinGecko failed: ${JSON.stringify(response.data).substring(0, 200)}`);
        }
    } catch (e) {
        console.error(`  CoinGecko error: ${e.message}`);
    }

    return cryptos.map(c => ({ name: c.name, link: c.link, price: null, change: null }));
}

// ============ MEMES (CoinMarketCap - Curated Whitelist) ============

// Curated memecoin whitelist - only these symbols will be fetched
const MEME_WHITELIST = [
    'DOGE', 'SHIB', 'PEPE', 'TRUMP', 'BONK', 'PENGU', 'FLOKI', 'SPX', 'WIF', 
    'FARTCOIN', 'PIPPIN', 'BUILDON', 'TIBBIR', 'MELANIA', 'CHEEMS', 'APE', 'DOG', 
    'YZY', 'BRETT', 'WHITEWHALE', 'MOG', 'REKT', 'BIRB', 'PNUT', 'JELLYJELLY', 
    'POPCAT', 'MOODENG', 'NPC', 'MEME'
];

async function getMemes() {
    console.log('\n🐸 Fetching Meme coins (whitelist mode)...');
    console.log(`  Whitelist: ${MEME_WHITELIST.length} coins`);
    
    try {
        // Fetch quotes for whitelist symbols
        const symbols = MEME_WHITELIST.join(',');
        const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbols}`;
        const response = await fetchJSON(url, { 'X-CMC_PRO_API_KEY': CMC_API_KEY });
        
        if (response.status === 200 && response.data.data) {
            const data = response.data.data;
            
            // Convert to array and add data
            let coins = Object.values(data).map(coin => ({
                symbol: coin.symbol,
                name: coin.name,
                slug: coin.slug,
                marketCap: coin.quote?.USD?.market_cap || 0,
                change: coin.quote?.USD?.percent_change_24h || 0
            }));
            
            console.log(`  Fetched ${coins.length} coins from whitelist`);
            
            // Sort by absolute % change (biggest movers first)
            coins.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
            
            // Return top 8
            const displayNames = { 'SPX': 'SPX6900', 'APE': 'APECOIN' };
            const results = coins.slice(0, 8).map(coin => {
                console.log(`  ${coin.symbol}: mcap=$${(coin.marketCap/1000000).toFixed(0)}M, change=${coin.change?.toFixed(2)}%`);
                return {
                    name: displayNames[coin.symbol] || coin.symbol,
                    link: `https://coinmarketcap.com/currencies/${coin.slug}/`,
                    price: coin.marketCap,
                    change: coin.change
                };
            });
            
            return results;
        } else {
            console.log(`  Error: ${JSON.stringify(response.data).substring(0, 300)}`);
        }
    } catch (e) {
        console.error(`  CMC error: ${e.message}`);
    }
    
    return [];
}

// ============ NFTs (CoinGecko with CACHING) ============
const nftCache = {
    data: null,
    allCollections: null,
    timestamp: null,
    isFetching: false,
    CACHE_DURATION: 60 * 60 * 1000  // 1 hour cache
};

// NFT Collections (78 total) - Generated 2/2/2026
const NFT_COLLECTIONS = [
    { id: 'cryptopunks', name: 'CryptoPunks' },
    { id: 'bored-ape-yacht-club', name: 'Bored Ape Yacht Club' },
    { id: 'pudgy-penguins', name: 'Pudgy Penguins' },
    { id: 'autoglyphs', name: 'Autoglyphs' },
    { id: 'chromie-squiggle-by-snowfro', name: 'Chromie Squiggle by Snowfro' },
    { id: 'fidenza-by-tyler-hobbs', name: 'Fidenza by Tyler Hobbs' },
    { id: 'mutant-ape-yacht-club', name: 'Mutant Ape Yacht Club' },
    { id: 'moonbirds', name: 'Moonbirds' },
    { id: 'lilpudgys', name: 'Lil Pudgys' },
    { id: 'milady-maker', name: 'Milady Maker' },
    { id: 'meebits', name: 'Meebits' },
    { id: 'azuki', name: 'Azuki' },
    { id: 'good-vibes-club', name: 'Good Vibes Club' },
    { id: 'clonex', name: 'Clone X' },
    { id: 'otherdeed-expanded', name: 'Otherdeed Expanded' },
    { id: 'max-pain-and-frens-by-xcopy', name: 'MAX PAIN AND FRENS BY XCOPY' },
    { id: 'doodles-official', name: 'Doodles' },
    { id: 'cryptodickbutts', name: 'CryptoDickbutts' },
    { id: 'veefriends-series-2', name: 'VeeFriends Series 2' },
    { id: 'otherdeed-for-otherside', name: 'Otherdeed for Otherside' },
    { id: 'creepz-genesis', name: 'Creepz by OVERLORD' },
    { id: 'mfers', name: 'mfers' },
    { id: 'winds-of-yawanawa-by-yawanawa-and-refik-anadol', name: 'Winds of Yawanawa' },
    { id: 'mooncats-acclimated', name: 'MoonCats' },
    { id: 'hytopia-worlds', name: 'TOPIA Worlds' },
    { id: 'cryptoadz', name: 'CrypToadz' },
    { id: 'nakamigos', name: 'Nakamigos' },
    { id: 'mocaverse', name: 'Mocaverse' },
    { id: 'the-captainz', name: 'Captainz' },
    { id: 'rektguy', name: 'rektguy' },
    { id: 'cool-cats', name: 'Cool Cats' },
    { id: 'bored-ape-kennel-club', name: 'Bored Ape Kennel Club' },
    { id: 'degods', name: 'DeGods' },
    { id: 'world-of-women', name: 'World of Women' },
    { id: 'redacted-remilio-babies', name: 'Redacted Remilio Babies' },
    { id: 'moonbirds-mythics', name: 'Moonbirds Mythics' },
    { id: 'opepen-edition', name: 'Opepen Edition' },
    { id: 'infinex-patrons', name: 'Infinex Patrons' },
    { id: 'azuki-elementals', name: 'Azuki Elementals' },
    { id: 'pudgy-presents', name: 'Pudgy Rods' },
    { id: 'goblintown-wtf-2', name: 'goblintown.wtf' },
    { id: 'sappy-seals', name: 'Sappy Seals' },
    { id: 'neo-tokyo-citizens', name: 'Neo Tokyo Citizen V2' },
    { id: 'my-curio-cards', name: 'My Curio Cards' },
    { id: 'checks-vv-originals', name: 'Checks' },
    { id: 'beanz-official', name: 'BEANZ Official' },
    { id: 'moonbirds-oddities', name: 'Moonbirds Oddities' },
    { id: 'sam-spratt-luci-chapter-5-the-monument-game', name: 'Sam Spratt LUCI' },
    { id: 'parallel-avatars', name: 'Parallel Avatars' },
    { id: '0n1force', name: '0N1 Force' },
    { id: 'sproto-gremlins', name: 'Sproto Gremlins' },
    { id: 'invisible-friends', name: 'Invisible Friends' },
    { id: 'pixelmon', name: 'Pixelmon' },
    { id: 'otherside-koda', name: 'Otherside Koda' },
    { id: 'cryptopunks-v1-wrapped', name: 'CryptoPunks V1 (wrapped)' },
    { id: 'vv-checks', name: 'Checks - VV Edition' },
    { id: 'murakami-flowers-official', name: 'Murakami.Flowers Official' },
    { id: 'jirasan', name: 'Jirasan' },
    { id: 'deadfellaz', name: 'DeadFellaz' },
    { id: 'lazy-lions', name: 'Lazy Lions' },
    { id: 'renga', name: 'RENGA' },
    { id: 'hv-mtl', name: 'HV-MTL' },
    { id: 'decentraland', name: 'Decentraland' },
    { id: 'digidaigaku', name: 'DigiDaigaku' },
    { id: 'braindrops', name: 'BrainDrops' },
    { id: 'sandbox', name: 'The Sandbox LANDS' },
    { id: 'hashmasks', name: 'Hashmasks' },
    { id: 'terraforms-by-mathcastles', name: 'Terraforms by Mathcastles' },
    { id: 'evmavericks', name: 'EVMavericks' },
    { id: 'kaito-genesis', name: 'Yapybaras - Kaito Genesis' },
    { id: 'cambria-founders', name: 'Cambria Founders' },
    { id: 'psychedelics-anonymous-genesis', name: 'Psychedelics Anonymous Genesis' },
    { id: 'wolf-game', name: 'Wolf Game' },
    { id: 'persona', name: 'Persona' },
    { id: 'the-plague', name: 'The Plague NFT' },
    { id: 'sugartown-oras', name: 'Sugartown Oras' },
    { id: 'bearish', name: 'Bearish' },
    { id: 'quirkies-originals', name: 'Quirkies Originals' },
    { id: 'hypurr-hyperevm', name: 'Hypurr HyperEVM' },
    { id: 'claynosaurz', name: 'Claynosaurz' }
];

// Fetch detailed data for a single collection from CoinGecko (using Demo API key)
async function fetchNFTDetails(id, name, slug) {
    try {
        // Use Demo API endpoint with Demo API key
        const url = `https://api.coingecko.com/api/v3/nfts/${id}`;
        const response = await fetchJSON(url, { 'x-cg-demo-api-key': COINGECKO_API_KEY });
        
        if (response.status === 200 && response.data) {
            const data = response.data;
            return {
                id: id,
                name: name || data.name || id,
                floorPrice: data.floor_price?.native_currency || 0,
                // Use native (ETH) percentage change to match CoinGecko website display
                change: data.floor_price_24h_percentage_change?.native_currency || 0,
                volume24h: data.volume_24h?.native_currency || 0,
                marketCap: data.market_cap?.native_currency || 0,
                link: `https://www.coingecko.com/en/nft/${id}`
            };
        } else if (response.status === 429) {
            return { error: 'rate_limited', id };
        }
    } catch (e) {
        console.log(`  Error fetching ${name || id}: ${e.message}`);
    }
    return null;
}

// Background fetch all NFT data (slow, with delays to avoid rate limits)
async function fetchAllNFTData() {
    if (nftCache.isFetching) {
        console.log('  NFT fetch already in progress...');
        return nftCache.data || [];
    }
    
    nftCache.isFetching = true;
    console.log('\n🖼️ Starting NFT fetch via CoinGecko Pro API (~2 minutes)...');
    
    const allResults = [];
    let rateLimitHits = 0;
    
    for (let i = 0; i < NFT_COLLECTIONS.length; i++) {
        const collection = NFT_COLLECTIONS[i];
        console.log(`  [${i + 1}/${NFT_COLLECTIONS.length}] Fetching ${collection.name}...`);
        
        const result = await fetchNFTDetails(collection.id, collection.name, collection.slug);
        
        if (result && result.error === 'rate_limited') {
            rateLimitHits++;
            console.log(`  Rate limited! Waiting 20s... (hit ${rateLimitHits} times)`);
            await new Promise(r => setTimeout(r, 20000));
            // Retry once
            const retry = await fetchNFTDetails(collection.id, collection.name, collection.slug);
            if (retry && !retry.error) {
                allResults.push(retry);
                console.log(`  ✓ ${retry.name}: floor=${retry.floorPrice.toFixed(2)} ETH, change=${retry.change.toFixed(2)}%`);
            } else if (retry && retry.error === 'rate_limited') {
                // Second retry with longer wait
                console.log(`  Still rate limited! Waiting 30s for second retry...`);
                await new Promise(r => setTimeout(r, 30000));
                const retry2 = await fetchNFTDetails(collection.id, collection.name, collection.slug);
                if (retry2 && !retry2.error) {
                    allResults.push(retry2);
                    console.log(`  ✓ ${retry2.name}: floor=${retry2.floorPrice.toFixed(2)} ETH, change=${retry2.change.toFixed(2)}%`);
                } else {
                    console.log(`  ✗ Failed to fetch ${collection.name} after 2 retries`);
                }
            }
        } else if (result) {
            allResults.push(result);
            console.log(`  ✓ ${result.name}: floor=${result.floorPrice.toFixed(2)} ETH, change=${result.change.toFixed(2)}%`);
        }
        
        // 2 second delay between requests (30 calls/min with API key)
        await new Promise(r => setTimeout(r, 2000));
    }
    
    console.log(`\n  ✅ NFT fetch complete! Got ${allResults.length} collections`);
    
    // Store all data in cache
    nftCache.allCollections = allResults;
    nftCache.timestamp = Date.now();
    nftCache.isFetching = false;
    
    // Process and store filtered results
    nftCache.data = processNFTResults(allResults);
    
    return nftCache.data;
}

// Process results: filter and sort
function processNFTResults(allResults) {
    // Filter: floor > 0.1 ETH (to exclude dust/dead collections)
    let valid = allResults.filter(nft => nft.floorPrice >= 0.1);
    console.log(`  Valid collections (>0.1 ETH floor): ${valid.length}`);
    
    // Sort ALL valid by absolute change - biggest movers first
    valid.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    
    console.log(`  Top movers:`);
    valid.slice(0, 10).forEach((nft, i) => {
        console.log(`    ${i+1}. ${nft.name}: ${nft.change >= 0 ? '+' : ''}${nft.change.toFixed(2)}%`);
    });
    
    // Return top 8 biggest movers, formatted for frontend
    return valid.slice(0, 8).map(nft => ({
        name: nft.name,
        link: nft.link,
        price: nft.floorPrice,
        change: nft.change
    }));
}

// Main NFT endpoint handler
async function getNFTs() {
    console.log('\n🖼️ NFT request received...');
    
    // Check if cache is valid
    const cacheAge = nftCache.timestamp ? Date.now() - nftCache.timestamp : Infinity;
    const cacheValid = cacheAge < nftCache.CACHE_DURATION;
    
    if (cacheValid && nftCache.data) {
        console.log(`  ✓ Returning cached data (${Math.round(cacheAge / 60000)} min old)`);
        return nftCache.data;
    }
    
    // If cache is stale but we have data, return it and trigger background refresh
    if (nftCache.data && !nftCache.isFetching) {
        console.log('  Cache stale, returning old data and refreshing in background...');
        fetchAllNFTData();  // Don't await - runs in background
        return nftCache.data;
    }
    
    // No cache at all - need to fetch
    if (!nftCache.isFetching) {
        console.log('  No cache, starting fresh fetch...');
        return await fetchAllNFTData();
    }
    
    // Fetch in progress, return partial/empty
    console.log('  Fetch in progress, returning partial data...');
    return nftCache.data || [];
}

// Endpoint to manually trigger NFT refresh
async function refreshNFTs() {
    console.log('\n🔄 Manual NFT refresh triggered...');
    nftCache.timestamp = null;  // Invalidate cache
    return await fetchAllNFTData();
}

// Endpoint to get cache status
function getNFTCacheStatus() {
    const cacheAge = nftCache.timestamp ? Date.now() - nftCache.timestamp : null;
    return {
        hasData: !!nftCache.data,
        dataCount: nftCache.data?.length || 0,
        allCollectionsCount: nftCache.allCollections?.length || 0,
        cacheAgeMinutes: cacheAge ? Math.round(cacheAge / 60000) : null,
        isFetching: nftCache.isFetching,
        cacheValid: cacheAge ? cacheAge < nftCache.CACHE_DURATION : false,
        source: 'CoinGecko API'
    };
}

// ============ GRAPHIC GENERATION ============
async function generateGraphic(data) {
    const { finance, crypto, nfts, memes } = data;
    
    // Format helpers matching newsletter template
    const formatFinanceValue = (item) => {
        if (!item || item.price === null || item.price === undefined) return 'N/A';
        if (item.name === 'DXY') return item.price.toFixed(2);
        if (item.name === 'GOLD') return '$' + Math.round(item.price).toLocaleString('en-US');
        if (item.name === 'S&P 500') return Math.round(item.price).toLocaleString('en-US');
        return '$' + item.price.toLocaleString('en-US');
    };
    
    const formatCryptoValue = (item) => {
        if (!item || item.price === null || item.price === undefined) return 'N/A';
        if (item.name === 'BTC') return '$' + (Math.round(item.price / 100) * 100).toLocaleString('en-US');
        if (item.name === 'ETH') return '$' + (Math.round(item.price / 10) * 10).toLocaleString('en-US');
        if (item.name === 'SOL') return '$' + (Math.round(item.price * 10) / 10).toFixed(2);
        if (item.price >= 10000) return '$' + Math.round(item.price).toLocaleString('en-US');
        return '$' + item.price.toFixed(2);
    };
    
    const formatNFTValue = (item) => {
        if (!item || item.price === null || item.price === undefined) return 'N/A';
        return item.price.toFixed(2) + ' ETH';
    };
    
    const formatMemeValue = (item) => {
        if (!item || item.price === null || item.price === undefined) return 'N/A';
        if (item.price >= 1000000000) return '$' + (item.price / 1000000000).toFixed(1) + 'B';
        if (item.price >= 1000000) return '$' + Math.round(item.price / 1000000) + 'M';
        return '$' + Math.round(item.price).toLocaleString('en-US');
    };
    
    const formatChange = (change) => {
        if (change === null || change === undefined) return 'N/A';
        const sign = change >= 0 ? '+' : '';
        return '(' + sign + change.toFixed(2) + '%)';
    };
    
    const getChangeClass = (change) => {
        if (change === null || change === undefined) return 'percent-positive';
        return change >= 0 ? 'percent-positive' : 'percent-negative';
    };

    // Build rows HTML
    const rows = [0, 1, 2].map(i => `
      <tr>
        <td>
          <div class="ticker-line"><span class="ticker-name">${finance[i]?.name || 'N/A'}</span><span class="ticker-value">: ${formatFinanceValue(finance[i])}</span></div><br>
          <span class="percent-pill ${getChangeClass(finance[i]?.change)}">${formatChange(finance[i]?.change)}</span>
        </td>
        <td>
          <div class="ticker-line"><span class="ticker-name">${crypto[i]?.name || 'N/A'}</span><span class="ticker-value">: ${formatCryptoValue(crypto[i])}</span></div><br>
          <span class="percent-pill ${getChangeClass(crypto[i]?.change)}">${formatChange(crypto[i]?.change)}</span>
        </td>
        <td>
          <div class="ticker-line"><span class="ticker-name">${(nfts[i]?.name || 'N/A').toUpperCase()}</span><span class="ticker-value">: ${formatNFTValue(nfts[i])}</span></div><br>
          <span class="percent-pill ${getChangeClass(nfts[i]?.change)}">${formatChange(nfts[i]?.change)}</span>
        </td>
        <td>
          <div class="ticker-line"><span class="ticker-name">${(memes[i]?.name || 'N/A').toUpperCase()}</span><span class="ticker-value">: ${formatMemeValue(memes[i])}</span></div><br>
          <span class="percent-pill ${getChangeClass(memes[i]?.change)}">${formatChange(memes[i]?.change)}</span>
        </td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #ffffff;
    }
    
    .table {
      width: 646px;
      border-collapse: collapse;
      background: #ffffff;
      border: 1px solid #d0d0d0;
      table-layout: fixed;
    }
    
    .table th, .table td {
      border: 1px solid #d0d0d0;
      text-align: center;
      vertical-align: middle;
    }
    
    .table th {
      background: #eaeaec;
      padding: 10px 8px;
    }
    
    .header-title {
      font-size: 16px;
      font-weight: 700;
      color: #000000;
      display: block;
    }
    
    .header-emoji {
      font-size: 18px;
      display: block;
      margin-top: 2px;
    }
    
    .table td {
      padding: 12px 6px;
    }
    
    .ticker-line {
      display: inline;
      white-space: nowrap;
    }
    
    .ticker-name {
      font-size: 14px;
      font-weight: 700;
      color: #2f63e7;
      text-decoration: underline;
    }
    
    .ticker-value {
      font-size: 14px;
      font-weight: 400;
      color: #000000;
    }
    
    .percent-pill {
      display: inline-block;
      margin-top: 5px;
      padding: 3px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 400;
    }
    
    .percent-positive {
      background: #23f079;
      color: #000000;
    }
    
    .percent-negative {
      background: #fa362f;
      color: #000000;
    }
  </style>
</head>
<body>
  <table class="table">
    <colgroup>
      <col style="width: 24.4%">
      <col style="width: 23.6%">
      <col style="width: 26.7%">
      <col style="width: 25.3%">
    </colgroup>
    <thead>
      <tr>
        <th><span class="header-title">Finance</span><span class="header-emoji">💸</span></th>
        <th><span class="header-title">Crypto Majors</span><span class="header-emoji">🪙</span></th>
        <th><span class="header-title">NFTs</span><span class="header-emoji">🦉</span></th>
        <th><span class="header-title">Memes</span><span class="header-emoji">😹</span></th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
    
    // Use Puppeteer to render HTML to PNG
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 646, height: 300 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Screenshot the table element
    const table = await page.$('.table');
    const screenshot = await table.screenshot({ type: 'png' });
    await browser.close();
    
    return screenshot;
}

// ============ SERVER ============
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Generate Graphic endpoint
    if (url.pathname === '/api/generate-graphic' && req.method === 'POST') {
        try {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                const data = JSON.parse(body);
                const imageBuffer = await generateGraphic(data);
                res.writeHead(200, { 
                    'Content-Type': 'image/png',
                    'Content-Disposition': 'attachment; filename="market-snapshot.png"'
                });
                res.end(imageBuffer);
            });
        } catch (e) {
            console.error('Generate graphic error:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // Serve static files
    if (url.pathname === '/' || url.pathname === '/index.html') {
        const filePath = path.join(__dirname, 'index.html');
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        } catch (e) {
            res.writeHead(404);
            res.end('File not found');
        }
        return;
    }

    // API endpoints
    if (url.pathname === '/api/finance') {
        try {
            const data = await getFinance();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('Finance API error:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (url.pathname === '/api/crypto') {
        try {
            const data = await getCrypto();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('Crypto API error:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (url.pathname === '/api/memes') {
        try {
            const data = await getMemes();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('Memes API error:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (url.pathname === '/api/nfts') {
        try {
            const data = await getNFTs();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('NFTs API error:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // NFT cache status endpoint
    if (url.pathname === '/api/nfts/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getNFTCacheStatus()));
        return;
    }

    // Manual NFT refresh endpoint
    if (url.pathname === '/api/nfts/refresh') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'NFT refresh started', status: getNFTCacheStatus() }));
        refreshNFTs();  // Fire and forget
        return;
    }

    // Get all cached collections (for debugging)
    if (url.pathname === '/api/nfts/all') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nftCache.allCollections || []));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log('');
    console.log('🚀 Market Snapshot Server');
    console.log('========================');
    console.log(`Running at http://localhost:${PORT}`);
    console.log('');
    console.log('Endpoints:');
    console.log('  /api/finance      - S&P 500, Gold, DXY (Yahoo Finance)');
    console.log('  /api/crypto       - BTC, ETH, SOL (CoinGecko)');
    console.log('  /api/memes        - Memecoins (CoinMarketCap)');
    console.log('  /api/nfts         - NFT Collections - cached (CoinGecko)');
    console.log('  /api/nfts/status  - NFT cache status');
    console.log('  /api/nfts/refresh - Trigger NFT cache refresh');
    console.log('  /api/nfts/all     - All cached NFT data');
    console.log('');
    console.log('Open http://localhost:3000 in your browser');
    console.log('Press Ctrl+C to stop');
    console.log('');
    
    // Start pre-fetching NFT data on server start
    console.log('📦 Pre-fetching NFT data in background...');
    fetchAllNFTData();
});
