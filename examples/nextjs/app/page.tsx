import { SignupForm } from './SignupForm';
import { Surface } from './Surface';

export default function Home() {
  return (
    <main
      style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: '40rem' }}
    >
      <h1>Intempt + Next.js</h1>
      <p>
        The SDK is loaded in <code>app/layout.tsx</code> as a{' '}
        <code>next/script</code> tag. Open the network tab and submit the form
        to watch events go out.
      </p>
      <SignupForm />
      <Surface />
    </main>
  );
}
