interface RequestMetrics {
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  timestamp: Date;
  cached: boolean;
  openaiTokens?: number;
  error?: string;
}

class MonitoringService {
  private metrics: RequestMetrics[] = [];
  private maxMetrics: number = 1000; // Keep last 1000 requests

  /**
   * Log a request metric
   */
  logRequest(metric: RequestMetrics): void {
    this.metrics.push(metric);
    
    // Keep only last maxMetrics entries
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // Log to console
    const logData = {
      ...metric,
      responseTime: `${metric.responseTime}ms`,
    };
    
    if (metric.statusCode >= 400) {
      console.error('Request failed:', logData);
    } else {
      console.log('Request completed:', logData);
    }
  }

  /**
   * Get summary statistics
   */
  getStats() {
    if (this.metrics.length === 0) {
      return {
        totalRequests: 0,
        avgResponseTime: 0,
        errorRate: 0,
        cacheHitRate: 0,
      };
    }

    const totalRequests = this.metrics.length;
    const avgResponseTime = this.metrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests;
    const errors = this.metrics.filter(m => m.statusCode >= 400).length;
    const errorRate = (errors / totalRequests) * 100;
    const cached = this.metrics.filter(m => m.cached).length;
    const cacheHitRate = (cached / totalRequests) * 100;

    return {
      totalRequests,
      avgResponseTime: Math.round(avgResponseTime),
      errorRate: errorRate.toFixed(2) + '%',
      cacheHitRate: cacheHitRate.toFixed(2) + '%',
      errors,
      cached,
    };
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 10): RequestMetrics[] {
    return this.metrics
      .filter(m => m.statusCode >= 400)
      .slice(-limit)
      .reverse();
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }
}

// Export singleton
export const monitoring = new MonitoringService();
export default monitoring;