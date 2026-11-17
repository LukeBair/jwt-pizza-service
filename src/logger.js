const config = require('./config.js');

const SENSITIVE_KEYS = ['password', 'token', 'jwt', 'apikey', 'authorization', 'secret'];

class Logger {
  // Express middleware: logs every HTTP request/response.
  httpLogger = (req, res, next) => {
    const send = res.send;
    res.send = (resBody) => {
      const logData = {
        authorized: !!req.headers.authorization,
        path: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        reqBody: req.body,
        resBody,
      };
      this.log(this.statusToLogLevel(res.statusCode), 'http', logData);
      res.send = send;
      return res.send(resBody);
    };
    next();
  };

  dbLogger(sql, params) {
    this.log('info', 'db', { sql, params });
  }

  factoryLogger(logData) {
    this.log(logData.statusCode && logData.statusCode >= 400 ? 'error' : 'info', 'factory', logData);
  }

  unhandledErrorLogger(err) {
    this.log('error', 'unhandledError', { message: err.message, statusCode: err.statusCode ?? 500, stack: err.stack });
  }

  log(level, type, logData) {
    const labels = { component: this.source(), level, type };
    const values = [this.nowString(), this.sanitize(logData)];
    this.sendLogToGrafana({ streams: [{ stream: labels, values: [values] }] });
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  source() {
    return config.logging?.source ?? 'jwt-pizza-service';
  }

  // Deep-copies the data, masking any field whose key looks confidential.
  sanitize(logData) {
    const scrub = (value) => {
      if (Array.isArray(value)) return value.map(scrub);
      if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
          out[k] = SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s)) ? '*****' : scrub(v);
        }
        return out;
      }
      return value;
    };

    let data = logData;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return this.scrubString(data);
      }
    }
    return this.scrubString(JSON.stringify(scrub(data)));
  }

  // Catches secrets embedded in strings (e.g. bearer headers, JWTs inside text).
  scrubString(s) {
    return s.replace(/Bearer\s+[^"\s,]+/gi, 'Bearer *****').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '*****');
  }

  enabled() {
    return !process.env.JEST_WORKER_ID && !!config.logging?.endpointUrl;
  }

  sendLogToGrafana(event) {
    if (!this.enabled()) return;
    const { endpointUrl, accountId, apiKey } = config.logging;
    fetch(endpointUrl, {
      method: 'post',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accountId}:${apiKey}` },
    })
      .then((res) => {
        if (!res.ok) console.log(`Failed to send log to Grafana: ${res.status}`);
      })
      .catch((err) => console.log('Error sending log to Grafana', err.message));
  }
}

module.exports = new Logger();
