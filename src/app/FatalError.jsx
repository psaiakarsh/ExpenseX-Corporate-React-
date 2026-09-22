// FatalError — shown when saved data cannot be read (corrupted JSON), as in V1's showFatalError().
// Nothing is ever overwritten silently: the user reloads, or clears this app's data after typing CLEAR.
import { Component } from 'react';
import { clearAppData } from '../domain/storage.js';
import { Icon } from '../components/ui.jsx';
import { useDialogs } from './DialogContext.jsx';

export function FatalError({ error, onRecover }) {
  const { confirmTyped } = useDialogs();

  const clear = async () => {
    const confirmed = await confirmTyped({
      title: 'Clear app data',
      message: 'This deletes every ExpenseX Corporate record in this browser.',
      word: 'CLEAR',
      confirmLabel: 'Clear data',
    });
    if (!confirmed) return;
    clearAppData();
    window.location.hash = '#/login';
    onRecover?.();
  };

  return (
    <main className="auth-page" id="main">
      <section className="card fatal-card" role="alert">
        <h1><Icon name="alert" size={24} /> ExpenseX Corporate can't start</h1>
        <p>{error?.message ?? 'Saved data could not be read.'}</p>
        <p className="muted">
          Your data has not been changed. You can reload, or clear this app's saved data
          (only ExpenseX Corporate keys are removed) and start again.
        </p>
        <div className="row-actions">
          <button className="btn btn-ghost" type="button" onClick={() => window.location.reload()}>Reload</button>
          <button className="btn btn-danger" type="button" onClick={clear}>Clear app data</button>
        </div>
      </section>
    </main>
  );
}

// Catches render errors from the data layer (loadDb/getSessionUser throw on corrupted storage).
export class FatalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <FatalError error={this.state.error} onRecover={() => this.setState({ error: null })} />;
  }
}
