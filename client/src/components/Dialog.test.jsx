import { useCallback, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dialog from './Dialog';

function Example({ disabled = false }) {
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    return <><button onClick={() => setOpen(true)}>Open example</button>
        {open && <Dialog title="Example" onClose={close}><fieldset disabled={disabled}><input aria-label="Example input" /></fieldset><button>Last action</button></Dialog>}</>;
}

describe('dialog keyboard boundary', () => {
    it('skips controls disabled through a parent fieldset', async () => {
        render(<Example disabled />);
        await userEvent.click(screen.getByRole('button', { name: 'Open example' }));
        expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();
    });

    it('traps Tab and Shift+Tab and restores focus after Escape', async () => {
        render(<Example />);
        const trigger = screen.getByRole('button', { name: 'Open example' });
        await userEvent.click(trigger);
        const close = screen.getByRole('button', { name: 'Close dialog' });
        const last = screen.getByRole('button', { name: 'Last action' });
        expect(close).toHaveFocus();
        await userEvent.tab({ shift: true }); expect(last).toHaveFocus();
        await userEvent.tab(); expect(close).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });
});
