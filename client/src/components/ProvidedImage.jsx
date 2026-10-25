import { useEffect, useState } from 'react';
import Brand from './Brand';

const grayBackgrounds = ['bg-[#e3e5e8]', 'bg-[#d9dde2]'];

export default function ProvidedImage({ src, alt = '', index = 0, className = '' }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return <div className={`relative grid place-items-center overflow-hidden ${className}`}>
      <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />
    </div>;
  }

  return <div className={`grid place-items-center overflow-hidden ${grayBackgrounds[index % grayBackgrounds.length]} ${className}`}>
    <div className="scale-75"><Brand /></div>
  </div>;
}
