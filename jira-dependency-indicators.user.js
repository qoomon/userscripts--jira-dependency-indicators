// ==UserScript==
// @name         Jira Card Dependency Indicator
// @namespace    https://qoomon.github.io
// @version      1.0.0
// @updateURL    https://github.com/qoomon/userscript-jira-dependency-indicators/raw/main/aws-visual-account-indicator.user.js
// @downloadURL  https://github.com/qoomon/userscript-jira-dependency-indicators/raw/main/aws-visual-account-indicator.user.js
// @description  try to take over the world!
// @author       qoomonu
// @match        https://*.atlassian.net/jira/core/projects/*/board
// @match        https://*.atlassian.net/jira/software/c/projects/*/boards/*
// @icon         https://www.atlassian.com/favicon.ico
// @grant        none
// ==/UserScript==

const issueDataCache = {}

function detectProjectType() {
    if(document.location.pathname.startsWith('/jira/core')) {
        console.log('team managed project detected');
        return 'team'
    }
    if(document.location.pathname.startsWith('/jira/software')) {
        console.log('company managed project detected');
        return 'company'
    }
}

const projectType = detectProjectType()
const projectKey = document.location.pathname.match(/\/projects\/(?<project>[^/]+)\//).groups.project

window.addEventListener('load', async function() {
    'use strict';

    async function fetchIssueData(keys) {

        const result = []
        const newKeys = []
         console.log("issueDataCache get", issueDataCache)
        keys.forEach(key => {
          const issueData = issueDataCache[key]
          if(issueData) result.push(issueData)
          else newKeys.push(key)
        })

        if(newKeys.length === 0) return result
        console.info(`fetch issues ${newKeys.join(', ')}`);
        // TODO handle pagination
        const issues = await fetch(`${window.location.origin}/rest/api/3/search/?jql=${encodeURIComponent(`key in (${newKeys.join(',')})`)}&fields=issuelinks`)
            .then(res => res.json()).then(data => data.issues)

        console.log("issueDataCache push", issueDataCache)
        issues.forEach(issue => {
            issueDataCache[issue.key] = issue
            result.push(issue)
        })
        console.log("issueDataCache after", issueDataCache)

        return result
    }

    function normalizeIssueLink(link) {
        if(link.inwardIssue) {
            link.type.relation = link.type.inward
            link.issue = link.inwardIssue
        }
        if(link.outwardIssue) {
            link.type.relation = link.type.outward
            link.issue = link.outwardIssue
        }
        return link
    }

    function getProjectKey(issueKey) {
        return issueKey.split('-')[0]
    }

    function getBoardCards() {
        if(projectType === 'team') {
            const projectKey = document.location.pathname.match(/\/projects\/(?<project>[^/]+)\//).groups.project
            return [...document.querySelectorAll('div[data-rbd-draggable-id^="ISSUE::"]')].map(element => ({
                key: [...element.querySelectorAll('span')].find(e => e.innerText.startsWith(`${projectKey}-`)).innerText,
                element
            }))
        }
        if(projectType === 'company') {
            return [...document.querySelectorAll('.ghx-issue')].map(element => ({
                key: element.getAttribute('data-issue-key'),
                element
            }))
        }
    }

    function getBoardElement() {
      if(projectType === 'team') {
          return document.querySelector('#ak-main-content > div > div > div > div:last-child')
      }
      if(projectType === 'company') {
          return document.querySelector('#ghx-work')
      }
    }

    function createCornerSvg(color) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg",'svg');
        svg.innerHTML = `<polygon points="0,0 0,16 16,0"></polygon>`
        svg.style.cssText = `
            fill: ${color};
            position: absolute;
            top: 0;
            left: 0;
            borderRadius: 2px;
        `
        return svg
    }

    // -----------------------------------------------------------------------------

    const updateCards = async () => {
      const boardCards = getBoardCards()

      const newCards = boardCards.filter(card => !card.element.issue)
      await fetchIssueData(newCards.map(card => card.key))
      newCards.forEach(card => {
        const issueData = issueDataCache[card.key]
        card.element.issue = issueData // flag element

        const unresolvedDependencies = issueData.fields.issuelinks.map(normalizeIssueLink)
            .filter(link => link.type.name === 'Blocks' && link.type.relation === 'is blocked by')
            .filter(link => link.issue.fields.status.statusCategory.name !== 'Done')


        const internalDependencies = unresolvedDependencies.filter(link => getProjectKey(link.issue.key) === projectKey)
        if(internalDependencies.length){
            console.log("update card:", card)
            console.log('  has internal dependencies')
            const cornerSvg = createCornerSvg('#ffab00')
            cornerSvg.setAttribute('title', 'Issue has internal dependencies')
            card.element.appendChild(cornerSvg)
        }

        const externalDependencies = unresolvedDependencies.filter(link => getProjectKey(link.issue.key) !== projectKey)
        if(externalDependencies.length){
            console.log("update card:", card)
            console.log('  has external dependencies')
            const cornerSvg = createCornerSvg('#ff5631')
            cornerSvg.setAttribute('title', 'Issue has external dependencies')
            card.element.appendChild(cornerSvg)
        }

      })
    }

    await updateCards()

    const observer = new MutationObserver((mutations) => {
      const nodesAdded = mutations.some(mutation => mutation.addedNodes.length > 0)
      if(nodesAdded) updateCards()
    })
    observer.observe(getBoardElement(), { childList: true, subtree: true })
})
