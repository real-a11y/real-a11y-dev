// Every matcher, called the way a test calls it, on Vitest 4's `expect`. `tsc`
// passing proves each one is typed. Each `@ts-expect-error` proves the checker
// is not simply accepting everything: if its error ever goes away, the
// directive itself becomes the error.
import { type Assertion, expect } from "vitest";

declare const el: HTMLElement;
declare const contract: string;

expect(el).toHaveNoUnlabeledInteractive();
expect(el).toHaveValidHeadingOrder();
expect(el).toHaveLabeledDialogs();
expect(el).toHaveValidLandmarks();
expect(el).toHaveTabSequence(['button "Send"']);
expect(el).toBeValidA11yTree();
expect(el).toMatchA11yContract(contract);
expect(el).not.toHaveValidLandmarks();

// The asymmetric form, through `AsymmetricMatchersContaining`.
expect({ tree: el }).toEqual({ tree: expect.toBeValidA11yTree() });

// The subject stays in Vitest's own `T`, so `.resolves` still unwraps it.
export async function resolves(): Promise<void> {
  await expect(Promise.resolve(el)).resolves.toHaveValidLandmarks();
}

// Each matcher returns `void`, as Vitest's own do, not the subject type.
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
    ? true
    : false;
export const returnsVoid: Equals<
  ReturnType<Assertion<HTMLElement>["toHaveValidLandmarks"]>,
  void
> = true;

// @ts-expect-error -- not a matcher
expect(el).toHaveNoSuchMatcher();

// @ts-expect-error -- `toHaveTabSequence` takes a `string[]`
expect(el).toHaveTabSequence('button "Send"');
