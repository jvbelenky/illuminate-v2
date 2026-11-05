import { get } from 'svelte/store';
import { userSettings } from '$lib/stores/settings';

/**
 * Turning reflections on or off, the same from every control that does it
 * (Room › Reflectance's tick box, the summary's switch): on asks first with the
 * "Enable reflections?" dialog unless "Don't show this again" was ticked before;
 * off applies at once. Each change is one `apply` (one undo step).
 *
 * The host renders `EnableReflectionsDialog` while `confirming`, wired to
 * `enable` and `cancel`.
 */
export class ReflectionsToggle {
  confirming = $state(false);

  constructor(private readonly apply: (on: boolean) => void) {}

  /** Ask for reflections on or off; true when it applied now, false when the dialog is asking. */
  set = (on: boolean): boolean => {
    if (on && get(userSettings).warnEnableReflections) {
      this.confirming = true;
      return false;
    }
    this.apply(on);
    return true;
  };

  /** The dialog's Enable: "Don't show this again" is saved only here. */
  enable = (dontShowAgain: boolean) => {
    this.confirming = false;
    if (dontShowAgain) userSettings.update((s) => ({ ...s, warnEnableReflections: false }));
    this.apply(true);
  };

  /** The dialog's Cancel (Esc, a click outside): reflections stay off. */
  cancel = () => {
    this.confirming = false;
  };
}
