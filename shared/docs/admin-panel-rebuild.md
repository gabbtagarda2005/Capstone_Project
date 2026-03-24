# Admin panel — rebuild command, logic, and SQL

Use this as a **single prompt** for an AI or developer when rebuilding the Bus Ticketing **Admin** section, plus the technical behavior and queries that must match your database.

---

## 1. Rebuild command (copy-paste)

> I am rebuilding the Admin section of my Bus Ticketing Capstone. Please provide the code and logic for the following:
>
> **Dashboard statistics:** Cards for **total count of all available ticket records** and **sum of fares for the currently filtered passenger set** (Total Revenue, e.g. ₱168.00).
>
> **Passenger records table:** List **Passenger ID**, **Start**, **Destination**, and **Bus Operator name** (from DB, not “N/A”).
>
> **Data mapping fix:** The Bus Operator column must show the real operator name (e.g. `esfrsef dwadawd`). Use `issued_by_name` on insert and/or a **JOIN** to `bus_operators` on `issued_by_operator_id`.
>
> **Filter bar:** Search by **Passenger ID**; filter by **Day**, **Month**, **Year**, and **From/To** date range. Statistics and table must use the **same** filtered dataset for revenue sum and row list.
>
> **Operator management:** In **Recently Added Bus Operators**, each card shows **Name**, **Email**, **Operator ID**, and actions **View**, **Edit**, **Delete** (View opens a detail page for that operator).

---

## 2. How the admin side works

### A. Statistics

- **Total records (dashboard):** `COUNT(*)` over **all** rows in `tickets` (global total for the “all available records” card), unless you want that card to also respect filters — clarify in UI; typically one card is **global count** and revenue is **filtered**.
- **Total revenue:** `SUM(fare)` over the **same rows** shown in the table after filters (filtered passengers / revenue).

### B. Fixing “N/A” (operator name)

- **Cause:** UI read a field that was never written at ticket issue time, or only `operator_id` was stored.
- **Fix (backend):** On issue ticket, persist `issued_by_name` from the session. On read, use:
  - `t.issued_by_name`, **or**
  - `LEFT JOIN bus_operators o ON o.operator_id = t.issued_by_operator_id` and display  
    `COALESCE(t.issued_by_name, TRIM(CONCAT(o.first_name,' ',IFNULL(o.middle_name,''),' ',o.last_name)))`  
    (adjust for your SQL dialect).

### C. “View” on an operator card

- Navigate to `/operators/:operatorId` (or equivalent).
- **Tickets:** `SELECT * FROM tickets WHERE issued_by_operator_id = ?` (order by `created_at` DESC).
- **Login history:** `SELECT * FROM login_logs WHERE operator_id = ?` (order by `login_timestamp` DESC).

---

## 3. SQL — filtering and operator display

**Important:** Use **parentheses** when mixing date range with `OR` on `passenger_id`. Otherwise `OR` binds incorrectly.

### Display name in passenger list (JOIN)

```sql
SELECT
  t.passenger_id,
  t.start_location,
  t.destination,
  t.fare,
  COALESCE(
    NULLIF(TRIM(t.issued_by_name), ''),
    TRIM(CONCAT_WS(' ', o.first_name, NULLIF(TRIM(o.middle_name), ''), o.last_name))
  ) AS bus_operator_name,
  t.created_at
FROM tickets t
LEFT JOIN bus_operators o ON o.operator_id = t.issued_by_operator_id
WHERE 1 = 1
  AND (
    :passenger_search IS NULL
    OR :passenger_search = ''
    OR t.passenger_id LIKE CONCAT('%', :passenger_search, '%')
  )
  AND (
    (:range_start IS NULL OR t.created_at >= :range_start)
    AND (:range_end IS NULL OR t.created_at < :range_end)
  );
```

Set `:range_start` / `:range_end` from:

- **Day:** start of day … start of next day.
- **Month:** first day 00:00 … first day of next month.
- **Year:** Jan 1 … Jan 1 next year.
- **From/To:** user-selected start (inclusive) and end (exclusive next day or inclusive end-of-day — pick one and use consistently).

### Safer pattern (search OR date — only if product requires OR)

If the product truly needs `(date range) OR (passenger_id match)`, wrap explicitly:

```sql
WHERE (
  (t.created_at >= :start_date AND t.created_at < :end_date)
  OR (t.passenger_id LIKE CONCAT('%', :search, '%'))
)
```

Usually you want **AND**: rows must match **both** date rules **and** passenger search when both are set.

### Aggregates for the same filters

```sql
SELECT
  COUNT(*) AS total_records,
  COALESCE(SUM(t.fare), 0) AS total_revenue
FROM tickets t
LEFT JOIN bus_operators o ON o.operator_id = t.issued_by_operator_id
WHERE /* same predicates as list query */;
```

---

## 4. Frontend ↔ API contract (suggested)

| UI area | Method | Notes |
|--------|--------|--------|
| Dashboard stats | `GET /admin/stats` | Returns `totalTicketCount` (global) + optional `filteredCount` / `filteredRevenue` if you pass query params |
| Passenger records | `GET /admin/passenger-records?...` | Query: `passengerId`, `from`, `to`, `day`, `month`, `year` (encode one strategy) |
| Recent operators | `GET /admin/operators?recent=1` | For cards |
| Operator detail | `GET /admin/operators/:id` + `GET /admin/operators/:id/tickets` + `GET /admin/operators/:id/login-logs` | Or one combined payload |

Implement these on **`Backend/Admin_Backend`** against your SQL database; **`Frontend/Admin_Frontend`** calls these endpoints.

---

## 5. Related docs

- Table DDL and FKs: [`relational-ticketing-schema.md`](relational-ticketing-schema.md)
- MongoDB (GPS, etc.): [`mongodb-collections.md`](mongodb-collections.md)
