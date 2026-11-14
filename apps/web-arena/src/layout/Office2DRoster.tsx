import type { SessionEmployee } from "@factory-arena/protocol";

/** Lightweight list view of the office for low-power machines (no WebGL work at all). */
export function Office2DRoster(props: {
  employees: readonly SessionEmployee[];
  selectedEmployeeId: string | null;
  onSelect: (id: string) => void;
}) {
  const { employees, selectedEmployeeId, onSelect } = props;
  return (
    <div className="card roster-2d" data-testid="office-2d-roster">
      <h2>📋 Danh sách nhân viên phiên AI (chế độ 2D gọn nhẹ)</h2>
      <ul>
        {employees.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              aria-pressed={selectedEmployeeId === e.id}
              onClick={() => onSelect(e.id)}
            >
              <strong>{e.display_name}</strong> <code>{e.employee_code}</code>
              <span>
                {e.spatial_zone} · {e.avatar_pose}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
