import type { APIRequestContext } from "@playwright/test";

/**
 * Register `count` demo agents on the hub via the public participants API.
 * Returns the employee codes in creation order so tests can target badges by testid.
 */
export async function seedAgents(
  request: APIRequestContext,
  baseUrl: string,
  count: number,
  prefix = "OW",
): Promise<string[]> {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const response = await request.post(`${baseUrl}/api/v1/participants`, {
      data: {
        session_fingerprint: `mcp_bridge:${prefix.toLowerCase()}-${i}`,
        slug: `${prefix.toLowerCase()}-${i}`,
        employee_code: `${prefix}-${String(i).padStart(3, "0")}`,
        display_name: `${prefix} Agent ${String(i).padStart(3, "0")}`,
        transport_type: "mcp_bridge",
      },
    });
    if (response.status() !== 201) {
      throw new Error(`seedAgents: expected 201 for ${prefix}-${i}, got ${response.status()}`);
    }
    const employee = (await response.json()) as { employee_code?: string };
    codes.push(employee.employee_code ?? `${prefix}-${String(i).padStart(3, "0")}`);
  }
  return codes;
}
