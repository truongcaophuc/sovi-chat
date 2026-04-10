/**
 * Browser-compatible Parlant API wrapper.
 * Adapted from vietjet-crawler/demo for sovi-chat.
 */

interface CustomerData {
  id: string;
  name: string;
}

interface SessionData {
  agentId: string;
  customerId: string;
  title?: string;
}

interface EventData {
  kind: string;
  source: string;
  message?: string;
}

interface ListEventsOptions {
  minOffset?: number;
  kinds?: string;
  waitForData?: number;
}

class CustomersAPI {
  constructor(private baseUrl: string) {}

  async retrieve(customerId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/customers/${customerId}`);
    if (!res.ok) throw new Error(`Customer not found: ${res.status}`);
    return res.json();
  }

  async create(data: CustomerData): Promise<any> {
    const res = await fetch(`${this.baseUrl}/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create customer: ${res.status}`);
    return res.json();
  }
}

class AgentsAPI {
  constructor(private baseUrl: string) {}

  async list(): Promise<{ id: string; name: string }[]> {
    const res = await fetch(`${this.baseUrl}/agents`);
    if (!res.ok) throw new Error(`Failed to list agents: ${res.status}`);
    return res.json();
  }
}

class SessionsAPI {
  constructor(private baseUrl: string) {}

  async create(data: SessionData): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: data.agentId,
        customer_id: data.customerId,
        title: data.title,
      }),
    });
    if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
    return res.json();
  }

  async createEvent(sessionId: string, data: EventData): Promise<any> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create event: ${res.status}`);
    return res.json();
  }

  async listEvents(sessionId: string, options: ListEventsOptions = {}): Promise<any[]> {
    const params = new URLSearchParams();
    if (options.minOffset !== undefined) params.set("min_offset", String(options.minOffset));
    if (options.kinds) params.set("kinds", options.kinds);
    if (options.waitForData !== undefined) params.set("wait_for_data", String(options.waitForData));

    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/events?${params}`);
    if (!res.ok) throw new Error(`Failed to list events: ${res.status}`);
    return res.json();
  }
}

export class ParlantClient {
  public customers: CustomersAPI;
  public agents: AgentsAPI;
  public sessions: SessionsAPI;

  constructor(config: { environment: string }) {
    const baseUrl = config.environment.replace(/\/$/, "");
    this.customers = new CustomersAPI(baseUrl);
    this.agents = new AgentsAPI(baseUrl);
    this.sessions = new SessionsAPI(baseUrl);
  }
}

export default ParlantClient;
