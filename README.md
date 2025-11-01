# yls-summit-2025
https://vstfl.github.io/yls-summit-2025/

## Overview
This repository hosts a static webapp that will be published through GitHub Pages for the YLS Summit pitch. The app showcases a single, polished component that represents a broader framework for data-informed decision making in equitable transit planning.

## Vision & Motivation
Equity is often sidelined in transit planning because ingesting, analyzing, and automating internal and public datasets is time-consuming and seldom reusable. Our long-term goal is to build a repeatable methodology that agencies can adopt to integrate equity considerations into everyday decisions. The static demo here acts as a first step toward that framework—illustrating how data pipelines, automation, and transparent metrics can guide more equitable outcomes.

## Case Study: Equitable Bus Stop Allocation in Scarborough
We are prototyping an interactive component that explores how bus stops in Scarborough (Toronto) could be reallocated using:
- Demographic data (e.g., income, race, age, disability)
- Transit performance data (ridership, GTFS, GTFS-RT)
- Other contextual layers that surface equity gaps

The component will surface insights that decision-makers can use to balance access, demand, and fairness when modifying routes or stop spacing.

## Tech Stack
- Tailwind CSS for rapid, utility-first styling
- Svelte for building the interactive single-component experience
- MapLibre GL JS for map visualizations and spatial context
- Apache ECharts for complementary charts and data storytelling

## Project Scope
- Build a single static experience that communicates the core idea clearly within a 6-minute pitch.
- Highlight the pain points agencies face today and how the framework streamlines equitable planning.
- Document assumptions, methodology, and data needs so the concept can scale beyond the demo.

## Local Development
1. Install dependencies with `npm install`.
2. Run `npm run dev` to iterate locally.
3. Use `npm run lint` (if configured) to keep the codebase tidy.

## Building & Deployment
- `npm run build` outputs the static site to the `/docs` directory; GitHub Pages is configured to serve from there.
- Commit the contents of `/docs` to `main` to publish updates automatically.
- Keep assets and data files lightweight so they remain GitHub Pages friendly.

## Working With This Repo
- Treat `main` as the production branch deployed to GitHub Pages; keep the app fully static between builds (HTML/CSS/JS and assets only).
- Break the component into modular Svelte pieces so additional functionality can be layered in after the summit.
- Track outstanding data assumptions or desired integrations in issues to guide future iterations.
