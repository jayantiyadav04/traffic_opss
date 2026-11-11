export function Loading({ children = 'Loading records...' }) {
    return <p className="feedback" role="status">{children}</p>;
}

export function ErrorNotice({ message, onRetry }) {
    return <div className="feedback feedback-error" role="alert">
        <p>{message}</p>
        {onRetry && <button className="btn btn-outline" onClick={onRetry}>Retry</button>}
    </div>;
}
