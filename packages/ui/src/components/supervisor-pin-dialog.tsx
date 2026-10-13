import * as React from 'react';
import { Dialog } from '../primitives/dialog.js';
import { PinPad } from '../primitives/pin-pad.js';
import { Button } from '../primitives/button.js';

export interface SupervisorPinDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onAuthorize: (supervisorPin: string) => Promise<void> | void;
  readonly requiredActionDescription?: string;
  readonly isSubmitting?: boolean;
  readonly errorMessage?: string;
}

export function SupervisorPinDialog({
  isOpen,
  onClose,
  onAuthorize,
  requiredActionDescription = 'Esta acción requiere autorización de supervisor o gerente.',
  isSubmitting = false,
  errorMessage,
}: SupervisorPinDialogProps): React.JSX.Element | null {
  const [pin, setPin] = React.useState('');

  const handleComplete = React.useCallback(
    (completedPin: string) => {
      onAuthorize(completedPin);
    },
    [onAuthorize],
  );

  const handleClose = React.useCallback(() => {
    setPin('');
    onClose();
  }, [onClose]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Autorización Requerida"
      description={requiredActionDescription}
    >
      <div className="flex flex-col items-center gap-4 py-2">
        <PinPad
          value={pin}
          onChange={setPin}
          onComplete={handleComplete}
          disabled={isSubmitting}
          isError={Boolean(errorMessage)}
          errorMessage={errorMessage}
          label="PIN de Supervisor o Gerente"
        />

        <div className="w-full flex justify-end gap-3 pt-3 border-t border-border mt-2">
          <Button
            type="button"
            intent="neutral"
            tone="outline"
            size="md"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
