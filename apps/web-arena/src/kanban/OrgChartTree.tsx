import type { SessionEmployee } from "@factory-arena/protocol";
import React from "react";

export function OrgChartTree({ employees }: { employees: SessionEmployee[] }) {
  const byDept = employees.reduce<Record<string, SessionEmployee[]>>((acc, emp) => {
    acc[emp.department] = acc[emp.department] ?? [];
    acc[emp.department].push(emp);
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      {Object.entries(byDept).map(([dept, list]) => (
        <div
          key={dept}
          style={{
            background: "#0c1428",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: "0.76rem"
          }}
        >
          <strong style={{ color: "var(--accent)", textTransform: "uppercase" }}>{dept}</strong>:{" "}
          {list.map((e) => `${e.display_name} (${e.employee_code})`).join(" · ")}
        </div>
      ))}
    </div>
  );
}
