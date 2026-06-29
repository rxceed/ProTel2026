import { ReactNode, createContext, useContext, useState } from 'react';
import { Button } from '@/components/ui/button';

interface DialogState {
  type: 'alert' | 'confirm';
  message: string;
  resolve: (value: boolean | PromiseLike<boolean>) => void;
}

const DialogContext = createContext<{
  alert: (message: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
} | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const alert = (message: string) => {
    return new Promise<void>((resolve) => {
      setDialog({
        type: 'alert',
        message,
        resolve: () => {
          setDialog(null);
          resolve();
        }
      });
    });
  };

  const confirm = (message: string) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        type: 'confirm',
        message,
        resolve: (val) => {
          setDialog(null);
          resolve(!!val);
        }
      });
    });
  };

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-2xl border p-5 flex flex-col space-y-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-base font-semibold text-foreground">
              {dialog.type === 'confirm' ? 'Konfirmasi' : 'Informasi'}
            </h3>
            <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
              {dialog.message}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              {dialog.type === 'confirm' ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => dialog.resolve(false)}
                    className="px-4 py-2 text-xs font-semibold"
                  >
                    Batal
                  </Button>
                  <Button
                    onClick={() => dialog.resolve(true)}
                    className="px-4 py-2 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    Ya
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => dialog.resolve(true)}
                  className="px-4 py-2 text-xs font-semibold"
                >
                  OK
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}
