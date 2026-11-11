class AppError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        if (details) this.details = details;
    }
}
module.exports = AppError;
