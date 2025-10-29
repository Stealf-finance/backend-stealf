export enum ErrorCode {
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
    SESSION_EXPIRED = 'SESSION_EXPIRED',
    INVALID_OTP = 'INVALID_OTP',
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
    INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
    TRANSACTION_FAILED = 'TRANSACTION_FAILED',
    INVALID_ADDRESS = 'INVALID_ADDRESS',
    VALIDATION_ERROR = 'VALIDATION_ERROR'
}

export interface ErrorResponse {
    error: string;
    code?: ErrorCode;
    details?: any[];
    status: number;
}
