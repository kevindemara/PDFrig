import { useEffect, useRef } from 'react';

export const ImageSignaturePreview = ({
  bytes,
  mimeType,
}: {
  readonly bytes: Uint8Array;
  readonly mimeType: 'image/jpeg' | 'image/png';
}) => {
  const image = useRef<SVGImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }));
    const target = image.current;
    target?.setAttribute('href', url);
    return () => {
      target?.removeAttribute('href');
      URL.revokeObjectURL(url);
    };
  }, [bytes, mimeType]);
  return (
    <>
      <span className="visually-hidden">Uploaded visual mark</span>
      {
        <svg
          aria-hidden="true"
          className="annotation-vector-preview"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <image ref={image} width={100} height={100} preserveAspectRatio="none" />
        </svg>
      }
    </>
  );
};
