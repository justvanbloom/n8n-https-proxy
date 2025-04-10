// tunnel-proxy.js
const https = require('https');
const http = require('http');
const fs = require('fs');
const url = require('url');
const tunnel = require('tunnel');

// Configuration from environment variables
const config = {
    proxyPort: process.env.PROXY_PORT || 8443,
    proxyHost: process.env.PROXY_HOST || '0.0.0.0',
    corporateProxyUrl: process.env.CORPORATE_PROXY || 'http://corporate_proxy:1234',
    allowedIPs: (process.env.ALLOWED_IPS || '127.0.0.1,localhost').split(',')
};

// Parse corporate proxy URL
const corporateProxy = url.parse(config.corporateProxyUrl);

// Function to check if client IP is allowed
function isClientAllowed(ip) {
    // Always allow localhost
    if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') {
        return true;
    }
    
    // Check if IP is in allowed list
    return config.allowedIPs.some(allowedIP => {
        // Exact IP match
        if (ip === allowedIP) {
            return true;
        }
        
        // Wildcard match (e.g., 192.168.1.*)
        if (allowedIP.includes('*')) {
            const parts = allowedIP.split('*');
            const prefix = parts[0];
            return ip.startsWith(prefix);
        }
        
        // CIDR notation (very basic implementation)
        if (allowedIP.includes('/')) {
            const [subnet, maskBits] = allowedIP.split('/');
            const mask = parseInt(maskBits);
            
            if (isNaN(mask)) return false;
            
            const ipParts = ip.split('.').map(Number);
            const subnetParts = subnet.split('.').map(Number);
            
            // Compare only the network part
            for (let i = 0; i < Math.ceil(mask / 8); i++) {
                const remainingBits = mask - i * 8;
                const bitsToCompare = remainingBits >= 8 ? 8 : remainingBits;
                
                if (bitsToCompare === 8) {
                    if (ipParts[i] !== subnetParts[i]) {
                        return false;
                    }
                } else {
                    // For partial byte comparison
                    const mask = 256 - Math.pow(2, 8 - bitsToCompare);
                    if ((ipParts[i] & mask) !== (subnetParts[i] & mask)) {
                        return false;
                    }
                }
            }
            
            return true;
        }
        
        return false;
    });
}

// SSL certificate configuration
const options = {
    key: fs.readFileSync('private.key'),
    cert: fs.readFileSync('certificate.crt')
};

// Create tunneling agent
const tunnelAgent = tunnel.httpsOverHttp({
    proxy: {
        host: corporateProxy.hostname,
        port: parseInt(corporateProxy.port) || 1234
    }
});

// Create HTTPS proxy server
const server = https.createServer(options, (req, res) => {
    try {
        // Get client IP
        const clientIP = req.socket.remoteAddress.replace(/^.*:/, '');
        console.log(`Request from ${clientIP} for: ${req.url}`);
        
        // Check if client is allowed
        if (!isClientAllowed(clientIP)) {
            console.log(`Access denied for IP: ${clientIP}`);
            res.writeHead(403);
            res.end('Access denied. Your IP is not on the allowed list.');
            return;
        }
        
        // Get target URL from request
        const targetUrl = req.url.startsWith('http') ? 
            url.parse(req.url) : 
            url.parse(`https://${req.url}`);
            
        // Only handle HTTPS targets
        if (targetUrl.protocol !== 'https:') {
            res.writeHead(400);
            res.end('Only HTTPS targets are supported');
            return;
        }
        
        console.log(`Forwarding request to: ${targetUrl.href}`);
        
        // Prepare request options with tunneling agent
        const requestOptions = {
            host: targetUrl.hostname,
            port: targetUrl.port || 443,
            path: targetUrl.path || '/',
            method: req.method,
            headers: {...req.headers, host: targetUrl.host},
            agent: tunnelAgent
        };
        
        // Make request to target using tunneling agent
        const targetReq = https.request(requestOptions, (targetRes) => {
            // Forward response headers and status
            res.writeHead(targetRes.statusCode, targetRes.headers);
            
            // Pipe response body
            targetRes.pipe(res);
        });
        
        // Handle target request errors
        targetReq.on('error', (error) => {
            console.error(`Target request error: ${error.message}`);
            if (!res.headersSent) {
                res.writeHead(502);
                res.end(`Error connecting to target: ${error.message}`);
            }
        });
        
        // Pipe original request body to target
        req.pipe(targetReq);
        
    } catch (error) {
        console.error(`General error: ${error.message}`);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end(`Internal server error: ${error.message}`);
        }
    }
});

// Start the server
server.listen(config.proxyPort, config.proxyHost, () => {
    console.log(`Tunnel Proxy Server running at https://${config.proxyHost}:${config.proxyPort}/`);
    console.log(`Using corporate proxy: ${config.corporateProxyUrl}`);
    console.log(`Allowed IPs: ${config.allowedIPs.join(', ')}`);
});

server.on('error', (error) => {
    console.error(`Server error: ${error.message}`);
});
