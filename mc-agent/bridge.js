const http = require('http')

// Send observation to Python brain, get action back
async function getAction(observation, memory, recentActions = []) {
  return new Promise((resolve, reject) => {
    // Clean recentActions to prevent JSON issues
    const safeRecentActions = (recentActions || []).map(a => ({
      action: a.action || '',
      target: a.target || null,
      success: !!a.success,
      reason: a.reason || '',
      context: a.context || {}
    }))

    const body = JSON.stringify({ observation, memory, recent_actions: recentActions })

     
    //console.log('[BRIDGE] Sending body length:', body.length)
    //console.log('[BRIDGE] Buffer length:', Buffer.byteLength(body))

    const req = http.request({
      host: 'localhost',
      port: 5001,
      path: '/decide',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Invalid response from brain'))
        }
      })
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function reflect(memorySummary, recentActions) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ memory_summary: memorySummary, recent_actions: recentActions })

    const req = http.request({
      host: 'localhost',
      port: 5001,
      path: '/reflect',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve([])
        }
      })
    })

    req.on('error', () => resolve([]))
    req.write(body)
    req.end()
  })
}

module.exports = { getAction, reflect }