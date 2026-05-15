"use client";

import React, { useState, useEffect } from "react";

const SEQUENCES = [
  "Empowering Agriculture\nGrowth through\nAI Intelligence.",
  "Transforming Agriculture\nDevelopment through\nData Intelligence.",
  "Revolutionizing Agriculture\nGrowth through\nSmart Intelligence.",
  "Driving Agriculture\nProgress through\nPredictive Intelligence.",
  "Advancing Agriculture\nSustainability through\nDigital Intelligence.",
];

interface TypewriterHeroProps {
  typingSpeed?: number;
  pauseDuration?: number;
}

export default function TypewriterHero({ typingSpeed = 40, pauseDuration = 0 }: TypewriterHeroProps) {
  const [sequenceIndex, setSequenceIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isBlinking, setIsBlinking] = useState(true);

  const currentSequence = SEQUENCES[sequenceIndex];
  const displayedText = currentSequence.substring(0, charIndex);

  useEffect(() => {
    if (charIndex < currentSequence.length) {
      setIsBlinking(false);
      const timeout = setTimeout(() => {
        setCharIndex((prev) => prev + 1);
      }, typingSpeed);
      return () => clearTimeout(timeout);
    } else {
      setIsBlinking(true);
      const timeout = setTimeout(() => {
        setCharIndex(0);
        setSequenceIndex((prev) => (prev + 1) % SEQUENCES.length);
      }, pauseDuration);
      return () => clearTimeout(timeout);
    }
  }, [charIndex, sequenceIndex, currentSequence.length, typingSpeed, pauseDuration]);

  const renderText = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      // Color the first word of the second line (index 1)
      if (i === 1) {
        const words = line.split(" ");
        if (words.length > 0) {
          const firstWord = words[0];
          const rest = words.slice(1).join(" ");
          return (
            <React.Fragment key={i}>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-blue-600">
                {firstWord}
              </span>
              {words.length > 1 ? <span>{" " + rest}</span> : null}
              {i < lines.length - 1 && <br />}
            </React.Fragment>
          );
        }
      }
      return (
        <React.Fragment key={i}>
          <span>{line}</span>
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="relative mb-8 text-left" translate="no">
      {/* Invisible Placeholder to prevent layout shifts */}
      <h1
        className="text-5xl lg:text-7xl font-black tracking-tight leading-tight opacity-0 pointer-events-none select-none"
        aria-hidden="true"
      >
        Revolutionizing Agriculture <br />
        Sustainability through <br />
        Predictive Intelligence.
      </h1>

      {/* Actual Animated Text */}
      <h1 className="absolute top-0 left-0 text-5xl lg:text-7xl font-black tracking-tight text-gray-900 dark:text-white leading-tight">
        <span>
          {renderText(displayedText)}
          <span
            className={`inline-block w-[0.08em] h-[1em] bg-emerald-500 ml-1 align-middle -mt-2 ${
              isBlinking ? "animate-pulse opacity-100" : "opacity-100"
            }`}
            style={{ animationDuration: "0.7s" }}
          />
        </span>
      </h1>
    </div>
  );
}
