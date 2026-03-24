export type TicketRow = {
  id: number;
  passengerId: string;
  startLocation: string;
  destination: string;
  fare: number;
  /** From DB: issued_by_name and/or JOIN to bus_operators */
  busOperatorName: string;
  issuedByOperatorId: number;
  createdAt: string;
};

export type OperatorSummary = {
  operatorId: number;
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string;
  phone: string | null;
  role: string;
  createdAt?: string;
};

export type LoginLogRow = {
  logId: number;
  operatorId: number;
  loginTimestamp: string;
};
