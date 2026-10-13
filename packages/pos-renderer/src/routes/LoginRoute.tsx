import * as React from 'react';
import { PinPad, Button } from '@trident/ui';
import { useSession } from '../context/SessionContext.js';

export interface LoginRouteProps {
  readonly onLoginSuccess?: () => void;
}

export function LoginRoute({ onLoginSuccess }: LoginRouteProps): React.JSX.Element {
  const { login, isLoading } = useSession();
  const [userCode, setUserCode] = React.useState('cajero');
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(undefined);

  const handlePinComplete = React.useCallback(
    async (pin: string) => {
      setErrorMessage(undefined);
      const res = await login(userCode, pin);
      if (res.success) {
        onLoginSuccess?.();
      } else {
        setErrorMessage(res.error || 'PIN incorrecto o usuario no autorizado.');
      }
    },
    [login, userCode, onLoginSuccess],
  );

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-bg text-text">
      <div className="w-full max-w-md p-8 bg-surface rounded-2xl border-2 border-border-control shadow-2 flex flex-col items-center gap-6">
        <div className="flex flex-col items-center text-center gap-1">
          <span className="text-2xl font-extrabold text-brand tracking-wider">TRIDENTPOS</span>
          <h1 className="text-xl font-bold text-text">Identificación de Operador</h1>
          <p className="text-sm text-text-muted">Seleccione su rol e ingrese su PIN de acceso</p>
        </div>

        {/* Quick User Role Selector */}
        <div className="grid grid-cols-2 gap-3 w-full" role="radiogroup" aria-label="Rol de operador">
          <Button
            intent={userCode === 'cajero' ? 'primary' : 'neutral'}
            tone={userCode === 'cajero' ? 'solid' : 'outline'}
            size="md"
            onClick={() => setUserCode('cajero')}
          >
            Cajero / Mesero
          </Button>
          <Button
            intent={userCode === 'admin' ? 'primary' : 'neutral'}
            tone={userCode === 'admin' ? 'solid' : 'outline'}
            size="md"
            onClick={() => setUserCode('admin')}
          >
            Gerente / Admin
          </Button>
        </div>

        {/* PIN Pad Component */}
        <PinPad
          onComplete={handlePinComplete}
          disabled={isLoading}
          isError={Boolean(errorMessage)}
          errorMessage={errorMessage}
          maxLength={4}
        />
      </div>
    </div>
  );
}
