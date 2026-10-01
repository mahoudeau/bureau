# Bureau Individual Contributor License Agreement

> **DRAFT.** Not in force. Pending Mathieu Mahoudeau's review and, ideally, a lawyer's look before anyone is asked to sign it. Bracketed notes marked `[REVIEW]` are open questions and get removed before publishing.

## In plain words

This summary is not part of the agreement. The numbered sections below are.

- You keep the copyright on what you contribute. You can use your own code however you like, elsewhere, forever.
- You give Mathieu Mahoudeau, who maintains Bureau, a permanent, free license to use, change and redistribute your contribution, including the right to sublicense it. You also give a patent license for any patents of yours that your contribution uses.
- You confirm the work is yours to give (or your employer has said yes), and you flag anything that comes from someone else.
- No warranty, no support owed. You contribute as is.

Why it exists: the hub is AGPL-3.0, and the specs, `brain-lint`, connectors and skills are Apache-2.0. The CLA keeps the option to offer the hub under other terms later, for example a hosted version, without tracking down every past contributor. That needs the right to relicense contributions, which the AGPL alone doesn't give. Nothing here changes the license your contribution ships under in this repository today.

How to sign: the CLA assistant bot comments on your first pull request with a link. Sign in with GitHub and accept. One signature covers every later contribution.

---

## Agreement (adapted from the Apache Software Foundation ICLA v2.2)

Thank you for your interest in Bureau, maintained by Mathieu Mahoudeau (the "Maintainer"). To clarify the intellectual property license granted with Contributions from any person or entity, the Maintainer must have on file a signed Contributor License Agreement ("CLA") from each Contributor, indicating agreement with the license terms below. This agreement is for your protection as a Contributor as well as the protection of the Maintainer and the users of Bureau. It does not change your rights to use your own Contributions for any other purpose.

You accept and agree to the following terms and conditions for Your Contributions (present and future) that you submit to the Maintainer. Except for the license granted herein to the Maintainer and recipients of software distributed by the Maintainer, You reserve all right, title, and interest in and to Your Contributions.

`[REVIEW] The Apache text puts a counterweight here: "In return, the Foundation shall not use Your Contributions in a way that is contrary to the public benefit or inconsistent with its nonprofit status and bylaws". That clause only makes sense for a nonprofit and is removed. Option: replace it with a promise such as "In return, the Maintainer agrees that the Work, including Your Contributions, will remain available under an OSI-approved open source license." Contributors tend to trust a relicensing CLA more with a promise like that. Mathieu's call.`

1. Definitions.

   "You" (or "Your") shall mean the copyright owner or legal entity authorized by the copyright owner that is making this Agreement with the Maintainer. For legal entities, the entity making a Contribution and all other entities that control, are controlled by, or are under common control with that entity are considered to be a single Contributor. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

   "Contribution" shall mean any original work of authorship, including any modifications or additions to an existing work, that is intentionally submitted by You to the Maintainer for inclusion in, or documentation of, the Bureau project, including the hub, its specifications, tools, connectors, skills and documentation, as published at https://github.com/mahoudeau/bureau (the "Work"). For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to the Maintainer or his representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, the Maintainer for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by You as "Not a Contribution."

   `[REVIEW] "the Maintainer" is Mathieu Mahoudeau as a person. If a company later runs the hosted offer, a lawyer should say whether the sublicense right in section 2 is enough, or whether this definition should also cover his successors, assigns and a legal entity he designates.`

2. Grant of Copyright License. Subject to the terms and conditions of this Agreement, You hereby grant to the Maintainer and to recipients of software distributed by the Maintainer a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute Your Contributions and such derivative works.

   `[REVIEW] This is the Apache wording unchanged. It includes "sublicense", which is what dual licensing relies on. Some projects add an explicit line such as "under any license terms, including proprietary ones" to remove doubt. Worth asking the lawyer whether it's needed.`

3. Grant of Patent License. Subject to the terms and conditions of this Agreement, You hereby grant to the Maintainer and to recipients of software distributed by the Maintainer a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by You that are necessarily infringed by Your Contribution(s) alone or by combination of Your Contribution(s) with the Work to which such Contribution(s) was submitted. If any entity institutes patent litigation against You or any other entity (including a cross-claim or counterclaim in a lawsuit) alleging that your Contribution, or the Work to which you have contributed, constitutes direct or contributory patent infringement, then any patent licenses granted to that entity under this Agreement for that Contribution or Work shall terminate as of the date such litigation is filed.

4. You represent that you are legally entitled to grant the above license. If your employer(s) has rights to intellectual property that you create that includes your Contributions, you represent that you have received permission to make Contributions on behalf of that employer, that your employer has waived such rights for your Contributions to the Maintainer, or that your employer has executed a separate Corporate CLA with the Maintainer.

   `[REVIEW] No Corporate CLA exists yet. Either draft one (the Apache CCLA is the matching reference) or drop the last clause until a company asks.`

5. You represent that each of Your Contributions is Your original creation (see section 7 for submissions on behalf of others). You represent that Your Contribution submissions include complete details of any third-party license or other restriction (including, but not limited to, related patents and trademarks) of which you are personally aware and which are associated with any part of Your Contributions.

6. You are not expected to provide support for Your Contributions, except to the extent You desire to provide support. You may provide support for free, for a fee, or not at all. Unless required by applicable law or agreed to in writing, You provide Your Contributions on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE.

7. Should You wish to submit work that is not Your original creation, You may submit it to the Maintainer separately from any Contribution, identifying the complete details of its source and of any license or other restriction (including, but not limited to, related patents, trademarks, and license agreements) of which you are personally aware, and conspicuously marking the work as "Submitted on behalf of a third-party: [named here]".

8. You agree to notify the Maintainer of any facts or circumstances of which you become aware that would make these representations inaccurate in any respect.

---

Signing: You sign this Agreement electronically by accepting it through the CLA assistant (https://cla-assistant.io) with your GitHub account. The record of your acceptance (GitHub username, date, and the version of this Agreement you accepted) is kept as the signed copy.

`[REVIEW] The Apache form collects full name, address and email. CLA assistant only records the GitHub account unless custom fields are configured. Decide whether a GitHub identity is enough, or add name and email fields. A lawyer may also want the governing law stated; the Apache ICLA doesn't state one.`
